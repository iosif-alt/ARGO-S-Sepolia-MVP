import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { AuthPrincipal, AuthService } from './auth-service';
import { DomainError, Repository, UserRole } from './domain';
import { InMemoryRepository } from './in-memory-repository';
import { MockBlockchainPort } from './mock-blockchain';
import { OnboardingService } from './onboarding-service';
import { Erc3643BlockchainPort } from './erc3643-blockchain';
import { PostgresRepository } from './postgres-repository';
import { InvestmentService, TronPaymentVerifier } from './investment-service';
import { GoogleLoginVerifier } from './google-auth';

const repository: Repository = process.env.DATABASE_URL ? new PostgresRepository(process.env.DATABASE_URL) : new InMemoryRepository();
const blockchain = process.env.ARGO_BLOCKCHAIN_MODE === 'erc3643'
  ? new Erc3643BlockchainPort({ rpcUrl: process.env.ARGO_RPC_URL ?? 'http://127.0.0.1:8545', operatorPrivateKey: requiredEnv('ARGO_OPERATOR_PRIVATE_KEY'), claimSignerPrivateKey: requiredEnv('ARGO_CLAIM_SIGNER_PRIVATE_KEY'), manifestPath: process.env.ARGO_MANIFEST_PATH ?? 'deployments/localhost-v2.json', claimTopicLabel: 'ARGO_KYC_APPROVED' })
  : new MockBlockchainPort();
const service = new OnboardingService(repository, blockchain, { walletDomain: process.env.ARGO_WALLET_DOMAIN ?? 'localhost', chainId: Number(process.env.ARGO_CHAIN_ID ?? '31337'), walletChallengeTtlSeconds: 300, kycWebhookSecret: process.env.KYC_WEBHOOK_SECRET ?? 'local-development-secret' });
const auth = new AuthService(repository, process.env.AUTH_SECRET ?? 'replace-this-local-secret-before-production');
const allowedOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:3000';
const tronConfig={apiUrl:process.env.TRONGRID_API_URL??'https://nile.trongrid.io',apiKey:process.env.TRONGRID_API_KEY,tokenContract:process.env.TRON_TUSDT_CONTRACT??'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',treasury:process.env.TRON_TREASURY_ADDRESS??'TUYfr6A9jtEgoePyewjFKwspVXcx34A4XS',decimals:Number(process.env.TRON_TUSDT_DECIMALS??'6')};
const investmentService=new InvestmentService(repository,new TronPaymentVerifier(tronConfig),tronConfig);
const googleRoles=Object.fromEntries([[process.env.GOOGLE_INVESTOR_EMAIL,'INVESTOR'],[process.env.GOOGLE_MAKER_EMAIL,'MAKER'],[process.env.GOOGLE_CHECKER_EMAIL,'CHECKER']].filter(([email])=>email).map(([email,role])=>[String(email).toLowerCase(),role])) as Record<string,UserRole>;
const googleLogin=new GoogleLoginVerifier(process.env.GOOGLE_CLIENT_ID??'',googleRoles);

function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
async function readBody(request: IncomingMessage): Promise<{ raw: string; json: Record<string, any> }> { const chunks: Buffer[]=[]; for await(const chunk of request) chunks.push(Buffer.from(chunk)); const raw=Buffer.concat(chunks).toString('utf8'); return {raw,json:raw?JSON.parse(raw):{}}; }
function send(response:ServerResponse,status:number,body:unknown):void { response.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':allowedOrigin,'access-control-allow-headers':'authorization,content-type,x-kyc-signature','access-control-allow-methods':'GET,POST,OPTIONS'}); response.end(JSON.stringify(body)); }
function principal(request:IncomingMessage):AuthPrincipal { const value=String(request.headers.authorization??''); if(!value.startsWith('Bearer ')) throw new DomainError('UNAUTHORIZED','Authentication required'); return auth.verify(value.slice(7)); }
function investorAccess(p:AuthPrincipal,id:string):void { if(p.role==='INVESTOR'&&p.investorId!==id) throw new DomainError('FORBIDDEN','Investor cannot access another profile'); }

async function route(request:IncomingMessage,response:ServerResponse):Promise<void>{
  const method=request.method??'GET'; const url=new URL(request.url??'/','http://localhost'); const parts=url.pathname.split('/').filter(Boolean);
  if(method==='OPTIONS') return send(response,204,{});
  if(method==='GET'&&url.pathname==='/health'){
    try{const [database,chain]=await Promise.all([repository.health(),blockchain.health()]);return send(response,200,{status:'ok',database:database?'ok':'unavailable',blockchain:'ok',chainId:chain.chainId,blockNumber:chain.blockNumber});}
    catch(error){return send(response,503,{status:'degraded',database:'unknown',blockchain:'unknown',message:error instanceof Error?error.message:'Health check failed'});}
  }
  if(method==='GET'&&url.pathname==='/public/config'){const token=await blockchain.tokenInfo();return send(response,200,{network:{name:Number(process.env.ARGO_CHAIN_ID)==11155111?'Ethereum Sepolia':'Local',chainId:Number(process.env.ARGO_CHAIN_ID??'31337'),explorer:Number(process.env.ARGO_CHAIN_ID)==11155111?'https://sepolia.etherscan.io':''},token,tron:{network:'Nile',explorer:'https://nile.tronscan.org',treasury:tronConfig.treasury,tokenContract:tronConfig.tokenContract,decimals:tronConfig.decimals}});}
  if(method==='POST'&&url.pathname==='/auth/register'){ const {json}=await readBody(request); const investor=await service.registerInvestor(json.email,json.type??'INDIVIDUAL',Number(json.country)); const user=await auth.createUser(json.email,json.password,'INVESTOR',investor.id); const session=await auth.login(user.email,json.password); return send(response,201,{...session,investor}); }
  if(method==='POST'&&url.pathname==='/auth/login'){ const {json}=await readBody(request); return send(response,200,await auth.login(json.email,json.password)); }
  if(method==='POST'&&url.pathname==='/auth/google'){const {json}=await readBody(request);const identity=await googleLogin.verify(json.credential);let user=await repository.findUserByEmail(identity.email);if(!user){let investorId:string|undefined;if(identity.role==='INVESTOR'){let investor=await repository.findInvestorByEmail(identity.email);if(!investor)investor=await service.registerInvestor(identity.email,'INDIVIDUAL',804);investorId=investor.id;}user=await auth.createExternalUser(identity.email,identity.role,investorId);}return send(response,200,auth.issueSession(user));}
  const actor=principal(request);
  if(method==='GET'&&url.pathname==='/me'){ const investor=actor.investorId?await service.getInvestor(actor.investorId):undefined; return send(response,200,{principal:actor,investor}); }
  if(method==='POST'&&url.pathname==='/orders'){ auth.requireRole(actor,['INVESTOR']); if(!actor.investorId)throw new DomainError('INVESTOR_NOT_FOUND','Investor profile is missing'); const {json}=await readBody(request); return send(response,201,await investmentService.createFixedOrder(await service.getInvestor(actor.investorId),json.tronSender)); }
  if(method==='GET'&&url.pathname==='/orders'){ auth.requireRole(actor,['INVESTOR']); return send(response,200,await repository.listOrdersByInvestor(String(actor.investorId))); }
  if(method==='POST'&&parts[0]==='orders'&&parts[2]==='payment'&&parts[3]==='verify'){ const order=await repository.getOrder(parts[1]); if(!order)throw new DomainError('ORDER_NOT_FOUND','Investment order not found'); investorAccess(actor,order.investorId); const {json}=await readBody(request); return send(response,200,await investmentService.verifyPayment(order.id,json.txId)); }
  if(method==='GET'&&url.pathname==='/admin/actions'){ auth.requireRole(actor,['MAKER','CHECKER','ADMIN']); return send(response,200,await repository.listActions((url.searchParams.get('status') as any)||undefined)); }
  if(method==='GET'&&parts[0]==='admin'&&parts[1]==='investors'&&parts[3]==='overview'){
    auth.requireRole(actor,['MAKER','CHECKER','ADMIN']); const investorId=parts[2];
    const [investor,orders,actions,audit]=await Promise.all([service.getInvestor(investorId),repository.listOrdersByInvestor(investorId),repository.listActionsByInvestor(investorId),repository.listAuditEvents(investorId)]);
    return send(response,200,{investor,orders,actions,audit});
  }
  if(method==='GET'&&parts[0]==='investors'&&parts.length===2){ investorAccess(actor,parts[1]); return send(response,200,await service.getInvestor(parts[1])); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='kyc'&&parts[3]==='start'){ investorAccess(actor,parts[1]); return send(response,200,await service.startKyc(parts[1])); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='kyc'&&parts[3]==='demo-approve'){
    if(process.env.ENABLE_DEMO_KYC!=='true') throw new DomainError('DEMO_DISABLED','Demo KYC is disabled'); investorAccess(actor,parts[1]);
    const investor=await service.getInvestor(parts[1]); const raw=JSON.stringify({eventId:randomUUID(),investorId:investor.id,providerCheckId:`demo-${randomUUID()}`,result:'APPROVED',country:investor.country,expiresAt:new Date(Date.now()+365*86400000).toISOString()});
    return send(response,200,await service.handleKycWebhook(raw,service.signKycWebhook(raw)));
  }
  if(method==='POST'&&url.pathname==='/webhooks/kyc'){ auth.requireRole(actor,['ADMIN']); const {raw}=await readBody(request); return send(response,200,await service.handleKycWebhook(raw,String(request.headers['x-kyc-signature']??''))); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='wallet'&&parts[3]==='challenge'){ investorAccess(actor,parts[1]); const {json}=await readBody(request); return send(response,201,await service.createWalletChallenge(parts[1],json.walletAddress)); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='wallet'&&parts[3]==='verify'){ investorAccess(actor,parts[1]); const {json}=await readBody(request); return send(response,200,await service.verifyWalletSignature(parts[1],json.signature)); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='onchain'&&parts[3]==='requests'){ auth.requireRole(actor,['MAKER','ADMIN']); return send(response,201,await service.requestOnchainEnrollment(parts[1],actor.userId)); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='documents'&&parts[3]==='confirm'){ auth.requireRole(actor,['MAKER','ADMIN']); return send(response,200,await service.confirmDocuments(parts[1],actor.userId)); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='payments'&&parts[3]==='confirm'){ auth.requireRole(actor,['MAKER','ADMIN']); return send(response,200,await service.confirmPayment(parts[1],actor.userId)); }
  if(method==='POST'&&parts[0]==='investors'&&parts[2]==='mint'&&parts[3]==='requests'){ auth.requireRole(actor,['MAKER','ADMIN']); const {json}=await readBody(request); return send(response,201,await service.requestMint(parts[1],String(json.amount),actor.userId)); }
  if(method==='POST'&&parts[0]==='admin'&&parts[1]==='actions'&&parts[3]==='approve'){ auth.requireRole(actor,['CHECKER','ADMIN']); return send(response,200,await service.approveAction(parts[2],actor.userId)); }
  return send(response,404,{error:'NOT_FOUND'});
}

async function bootstrap():Promise<void>{
  if(repository instanceof PostgresRepository) await repository.migrate();
  const accounts:[string,string,UserRole][]=[[process.env.LOCAL_MAKER_EMAIL??'maker@argo.local',process.env.LOCAL_MAKER_PASSWORD??'MakerDemo123!','MAKER'],[process.env.LOCAL_CHECKER_EMAIL??'checker@argo.local',process.env.LOCAL_CHECKER_PASSWORD??'CheckerDemo123!','CHECKER']];
  for(const [email,password,role] of accounts) if(!await repository.findUserByEmail(email)) await auth.createUser(email,password,role);
}
const server=createServer((request,response)=>{const started=Date.now();response.once('finish',()=>console.log(JSON.stringify({method:request.method,path:request.url,status:response.statusCode,durationMs:Date.now()-started})));route(request,response).catch((error:unknown)=>{ if(error instanceof DomainError){const status=error.code==='UNAUTHORIZED'?401:error.code==='FORBIDDEN'?403:409;return send(response,status,{error:error.code,message:error.message});} console.error(error); return send(response,500,{error:'INTERNAL_ERROR'});});});
const port=Number(process.env.PORT??'3001'); bootstrap().then(()=>server.listen(port,()=>console.log(`ARGO-S platform API listening on http://localhost:${port}`))).catch((error)=>{console.error(error);process.exitCode=1;});
