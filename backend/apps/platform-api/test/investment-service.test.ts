import { expect } from 'chai';
import { InvestmentService, TronPaymentVerifier } from '../src/investment-service';
import { InMemoryRepository } from '../src/in-memory-repository';
import { Investor } from '../src/domain';

describe('TRON investment order', () => {
  const config={apiUrl:'https://nile.trongrid.io',tokenContract:'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',treasury:'TUYfr6A9jtEgoePyewjFKwspVXcx34A4XS',decimals:6};
  it('matches a confirmed 100 tUSDT transfer to 1000 ARGOS',async()=>{
    const repository=new InMemoryRepository(); const service=new InvestmentService(repository,new TronPaymentVerifier(config),config);
    const investor:Investor={id:'00000000-0000-4000-8000-000000000001',email:'i@argo.test',type:'INDIVIDUAL',country:804,status:'WALLET_VERIFIED',walletAddress:'0x31D8d21cab5B9B884E876Ce467b66b6386e08eE7',tokenBalance:'0',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    await repository.saveInvestor(investor); const order=await service.createFixedOrder(investor,'TLcVKMx3oh2AZ57g3dDXXZ1TH7cGgoVWjs');
    const txId='a'.repeat(64); const previous=global.fetch; global.fetch=async()=>new Response(JSON.stringify({data:[{transaction_id:txId,from:order.tronSender,to:order.tronTreasury,value:'100000000',type:'Transfer',token_info:{address:order.tronTokenContract,decimals:6}}]}),{status:200});
    try{const verified=await service.verifyPayment(order.id,txId);expect(verified.status).to.equal('PAYMENT_VERIFIED');expect(verified.argosAmount).to.equal('1000');}finally{global.fetch=previous;}
  });
});
