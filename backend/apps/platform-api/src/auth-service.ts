import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { DomainError, Repository, UserAccount, UserRole } from './domain';

export interface AuthPrincipal { userId: string; email: string; role: UserRole; investorId?: string }

export class AuthService {
  constructor(private readonly repository: Repository, private readonly secret: string) {}

  async createUser(email: string, password: string, role: UserRole, investorId?: string): Promise<UserAccount> {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes('@')) throw new DomainError('INVALID_EMAIL', 'Email is invalid');
    if (password.length < 10) throw new DomainError('WEAK_PASSWORD', 'Password must contain at least 10 characters');
    if (await this.repository.findUserByEmail(normalized)) throw new DomainError('EMAIL_EXISTS', 'Account already exists');
    const user: UserAccount = { id: randomUUID(), email: normalized, passwordHash: this.hashPassword(password), role, investorId, createdAt: new Date().toISOString() };
    await this.repository.saveUser(user); return user;
  }

  async createExternalUser(email:string,role:UserRole,investorId?:string):Promise<UserAccount>{
    const normalized=email.trim().toLowerCase(); const existing=await this.repository.findUserByEmail(normalized); if(existing)return existing;
    const user:UserAccount={id:randomUUID(),email:normalized,passwordHash:'EXTERNAL_GOOGLE',role,investorId,createdAt:new Date().toISOString()};await this.repository.saveUser(user);return user;
  }

  issueSession(user:UserAccount):{token:string;principal:AuthPrincipal}{const principal={userId:user.id,email:user.email,role:user.role,investorId:user.investorId};return {token:this.sign(principal),principal};}

  async login(email: string, password: string): Promise<{ token: string; principal: AuthPrincipal }> {
    const user = await this.repository.findUserByEmail(email.trim().toLowerCase());
    if (!user || !this.verifyPassword(password, user.passwordHash)) throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
    return this.issueSession(user);
  }

  verify(token: string): AuthPrincipal {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature) throw new DomainError('UNAUTHORIZED', 'Authentication required');
    const expected = createHmac('sha256', this.secret).update(encoded).digest('base64url');
    const left = Buffer.from(signature); const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new DomainError('UNAUTHORIZED', 'Invalid session');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthPrincipal & { exp: number };
    if (payload.exp < Date.now()) throw new DomainError('UNAUTHORIZED', 'Session expired');
    return payload;
  }

  requireRole(principal: AuthPrincipal, roles: UserRole[]): void {
    if (!roles.includes(principal.role)) throw new DomainError('FORBIDDEN', 'Insufficient permissions');
  }

  private sign(principal: AuthPrincipal): string {
    const encoded = Buffer.from(JSON.stringify({ ...principal, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
    return `${encoded}.${createHmac('sha256', this.secret).update(encoded).digest('base64url')}`;
  }
  private hashPassword(password: string): string { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':'); if (!salt || !hash) return false;
    const actual = scryptSync(password, salt, 64); const expected = Buffer.from(hash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
