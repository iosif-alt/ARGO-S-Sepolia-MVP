import { createHash, randomUUID } from 'crypto';
import { DomainError, InvestmentOrder, Investor, Repository } from './domain';

const TRON_BASE58_ALPHABET =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Кодирует бинарные данные в Base58.
 * Используется при формировании стандартных TRON-адресов.
 */
function encodeBase58(buffer: Buffer): string {
  let value = BigInt(`0x${buffer.toString('hex') || '0'}`);
  let encoded = '';

  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = TRON_BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }

  for (const byte of buffer) {
    if (byte !== 0) break;
    encoded = '1' + encoded;
  }

  return encoded || '1';
}

/**
 * Преобразует TRON hex-адрес в Base58Check.
 *
 * TronGrid может возвращать:
 * - 0x + 40 hex-символов;
 * - 41 + 40 hex-символов;
 * - готовый Base58-адрес.
 */
function normalizeTronAddress(address: unknown): string {
  if (typeof address !== 'string' || address.trim() === '') {
    return '';
  }

  const original = address.trim();
  let hexAddress: string | undefined;

  if (/^0x[0-9a-fA-F]{40}$/.test(original)) {
    hexAddress = `41${original.slice(2)}`;
  } else if (/^41[0-9a-fA-F]{40}$/.test(original)) {
    hexAddress = original;
  }

  // Уже нормализованный Base58-адрес возвращается без изменений.
  if (!hexAddress) {
    return original;
  }

  const payload = Buffer.from(hexAddress, 'hex');

  // TRON использует первые четыре байта двойного SHA-256 как checksum.
  const firstHash = createHash('sha256').update(payload).digest();
  const secondHash = createHash('sha256').update(firstHash).digest();
  const checksum = secondHash.subarray(0, 4);

  return encodeBase58(Buffer.concat([payload, checksum]));
}


export interface TronPaymentConfig { apiUrl: string; apiKey?: string; tokenContract: string; treasury: string; decimals: number }
export class TronPaymentVerifier {
  constructor(private readonly config: TronPaymentConfig) {}
  async verify(txId: string, sender: string, amountAtomic: string): Promise<void> {
    if(!/^[0-9a-fA-F]{64}$/.test(txId)) throw new DomainError('INVALID_TRON_TXID','TRON txID must contain 64 hexadecimal characters');
    const headers:Record<string,string>=this.config.apiKey?{'TRON-PRO-API-KEY':this.config.apiKey}:{};
    // Query the exact transaction first. This avoids false negatives caused by
    // account-history pagination when a treasury receives many transfers.
    const eventsUrl=new URL(`/v1/transactions/${txId}/events`,this.config.apiUrl);
    eventsUrl.searchParams.set('only_confirmed','true');
    const eventsResponse=await fetch(eventsUrl,{headers});
    if(!eventsResponse.ok) throw new DomainError('TRONGRID_UNAVAILABLE','Unable to verify TRON payment');
    const eventsBody=await eventsResponse.json() as {data?:Array<{event_name?:string;contract_address?:string;result?:Record<string,string>}>};
    const transferEvent=eventsBody.data?.find(item=>item.event_name==='Transfer'&&item.contract_address===this.config.tokenContract);
    if(transferEvent){
      const result=transferEvent.result??{};

      // ABI может возвращать именованные или позиционные параметры события.
      const actualFrom=normalizeTronAddress(
        result.from??result._from??result['0']
      );
      const actualTo=normalizeTronAddress(
        result.to??result._to??result['1']
      );
      const actualValue=String(
        result.value??result._value??result['2']??''
      );

      const expectedSender=normalizeTronAddress(sender);
      const expectedTreasury=normalizeTronAddress(this.config.treasury);

      if(
        actualFrom!==expectedSender||
        actualTo!==expectedTreasury||
        actualValue!==amountAtomic
      ){
        throw new DomainError(
          'TRON_PAYMENT_MISMATCH',
          'TRON transfer does not match the investment order'
        );
      }

      return;
    }
    // Nile may expose account history before the event endpoint (or vice versa),
    // so retain a strict confirmed-transfer fallback for testnet resilience.
    const url=new URL(`/v1/accounts/${this.config.treasury}/transactions/trc20`,this.config.apiUrl);
    url.searchParams.set('only_confirmed','true'); url.searchParams.set('only_to','true'); url.searchParams.set('contract_address',this.config.tokenContract); url.searchParams.set('limit','200');
    const response=await fetch(url,{headers}); if(!response.ok) throw new DomainError('TRONGRID_UNAVAILABLE','Unable to verify TRON payment');
    const body=await response.json() as {data?:Array<{transaction_id:string;from:string;to:string;value:string;type:string;token_info:{address:string;decimals:number}}>};
    const transfer=body.data?.find(item=>item.transaction_id.toLowerCase()===txId.toLowerCase());
    if(!transfer) throw new DomainError('TRON_PAYMENT_NOT_CONFIRMED','Confirmed TRC-20 transfer was not found');
    if(transfer.type!=='Transfer'||transfer.from!==sender||transfer.to!==this.config.treasury||transfer.token_info.address!==this.config.tokenContract||transfer.token_info.decimals!==this.config.decimals||transfer.value!==amountAtomic){
      throw new DomainError('TRON_PAYMENT_MISMATCH','TRON transfer does not match the investment order');
    }
  }
}

export class InvestmentService {
  constructor(private readonly repository:Repository,private readonly tron:TronPaymentVerifier,private readonly config:TronPaymentConfig){}
  async createFixedOrder(investor:Investor,tronSender:string):Promise<InvestmentOrder>{
    if(investor.status!=='WALLET_VERIFIED') throw new DomainError('INVESTOR_NOT_READY','KYC and Ethereum wallet verification are required');
    if(!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(tronSender)) throw new DomainError('INVALID_TRON_ADDRESS','Invalid TRON sender address');
    const now=new Date(); const order:InvestmentOrder={id:randomUUID(),investorId:investor.id,tronSender,tronTreasury:this.config.treasury,tronTokenContract:this.config.tokenContract,paymentAmountAtomic:'100000000',paymentDecimals:6,argosAmount:'1000',priceLabel:'1 ARGOS = 0.10 tUSDT',status:'CREATED',expiresAt:new Date(now.getTime()+24*60*60*1000).toISOString(),createdAt:now.toISOString(),updatedAt:now.toISOString()};
    await this.repository.saveOrder(order); return order;
  }
  async verifyPayment(orderId:string,txId:string):Promise<InvestmentOrder>{
    const order=await this.repository.getOrder(orderId); if(!order)throw new DomainError('ORDER_NOT_FOUND','Investment order not found');
    if(order.status!=='CREATED')throw new DomainError('ORDER_ALREADY_PROCESSED','Investment order is already processed');
    if(Date.parse(order.expiresAt)<=Date.now())throw new DomainError('ORDER_EXPIRED','Investment order expired');
    if(await this.repository.findOrderByTronTxId(txId))throw new DomainError('TRON_TX_ALREADY_USED','TRON txID has already been used');
    await this.tron.verify(txId,order.tronSender,order.paymentAmountAtomic); order.tronTxId=txId;order.status='PAYMENT_VERIFIED';order.updatedAt=new Date().toISOString();await this.repository.saveOrder(order);return order;
  }
}
