import { OAuth2Client } from 'google-auth-library';
import { DomainError, UserRole } from './domain';

export class GoogleLoginVerifier{
  private readonly client:OAuth2Client;
  constructor(private readonly clientId:string,private readonly roles:Record<string,UserRole>){this.client=new OAuth2Client(clientId);}
  async verify(credential:string):Promise<{email:string;role:UserRole}>{
    if(!this.clientId)throw new DomainError('GOOGLE_AUTH_NOT_CONFIGURED','Google OAuth Client ID is not configured');
    const ticket=await this.client.verifyIdToken({idToken:credential,audience:this.clientId});const payload=ticket.getPayload();
    if(!payload?.email||!payload.email_verified)throw new DomainError('GOOGLE_EMAIL_NOT_VERIFIED','Google email is not verified');
    const email=payload.email.toLowerCase();const role=this.roles[email];if(!role)throw new DomainError('GOOGLE_ACCOUNT_NOT_ALLOWED','Google account is not assigned to an ARGO-S role');return {email,role};
  }
}
