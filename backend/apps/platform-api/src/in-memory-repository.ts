import { AdminAction, AdminActionStatus, AuditEvent, InvestmentOrder, Investor, Repository, UserAccount, WalletChallenge } from './domain';

/// Development repository used by automated tests and local demos.
export class InMemoryRepository implements Repository {
  private readonly investors = new Map<string, Investor>();
  private readonly challenges = new Map<string, WalletChallenge>();
  private readonly actions = new Map<string, AdminAction>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly webhookEvents = new Set<string>();
  private readonly users = new Map<string, UserAccount>();
  private readonly orders = new Map<string, InvestmentOrder>();

  async saveInvestor(investor: Investor): Promise<void> {
    this.investors.set(investor.id, structuredClone(investor));
  }

  async getInvestor(id: string): Promise<Investor | undefined> {
    const investor = this.investors.get(id);
    return investor ? structuredClone(investor) : undefined;
  }

  async findInvestorByEmail(email: string): Promise<Investor | undefined> {
    const normalized = email.toLowerCase();
    const investor = [...this.investors.values()].find((entry) => entry.email === normalized);
    return investor ? structuredClone(investor) : undefined;
  }

  async saveChallenge(challenge: WalletChallenge): Promise<void> {
    this.challenges.set(challenge.investorId, structuredClone(challenge));
  }

  async getChallenge(investorId: string): Promise<WalletChallenge | undefined> {
    const challenge = this.challenges.get(investorId);
    return challenge ? structuredClone(challenge) : undefined;
  }

  async saveAction(action: AdminAction): Promise<void> {
    this.actions.set(action.id, structuredClone(action));
  }

  async getAction(id: string): Promise<AdminAction | undefined> {
    const action = this.actions.get(id);
    return action ? structuredClone(action) : undefined;
  }

  async listActions(status?: AdminActionStatus): Promise<AdminAction[]> {
    return [...this.actions.values()].filter((action) => !status || action.status === status).map((action) => structuredClone(action));
  }

  async listActionsByInvestor(investorId: string): Promise<AdminAction[]> {
    return [...this.actions.values()].filter((action) => action.investorId === investorId).map((action) => structuredClone(action));
  }

  async claimAction(id: string, checkerId: string): Promise<AdminAction | undefined> {
    const action = this.actions.get(id);
    if (!action || !['PENDING', 'FAILED'].includes(action.status) || action.makerId === checkerId) return undefined;
    action.status = 'PROCESSING'; action.checkerId = checkerId; action.startedAt = new Date().toISOString(); action.errorMessage = undefined;
    this.actions.set(id, structuredClone(action));
    return structuredClone(action);
  }

  async saveUser(user: UserAccount): Promise<void> { this.users.set(user.id, structuredClone(user)); }
  async findUserByEmail(email: string): Promise<UserAccount | undefined> {
    const user = [...this.users.values()].find((entry) => entry.email === email.toLowerCase());
    return user ? structuredClone(user) : undefined;
  }
  async getUser(id: string): Promise<UserAccount | undefined> {
    const user = this.users.get(id); return user ? structuredClone(user) : undefined;
  }
  async saveOrder(order: InvestmentOrder): Promise<void> { this.orders.set(order.id, structuredClone(order)); }
  async getOrder(id: string): Promise<InvestmentOrder | undefined> { const x=this.orders.get(id); return x?structuredClone(x):undefined; }
  async listOrdersByInvestor(id: string): Promise<InvestmentOrder[]> { return [...this.orders.values()].filter(x=>x.investorId===id).map(x=>structuredClone(x)); }
  async findOrderByTronTxId(txId: string): Promise<InvestmentOrder | undefined> { const x=[...this.orders.values()].find(o=>o.tronTxId===txId); return x?structuredClone(x):undefined; }

  async listAuditEvents(investorId: string): Promise<AuditEvent[]> {
    return this.auditEvents.filter((event) => event.investorId === investorId).map((event) => structuredClone(event));
  }

  async health(): Promise<boolean> { return true; }

  async appendAudit(event: AuditEvent): Promise<void> {
    this.auditEvents.push(structuredClone(event));
  }

  async hasWebhookEvent(eventId: string): Promise<boolean> {
    return this.webhookEvents.has(eventId);
  }

  async markWebhookEvent(eventId: string): Promise<void> {
    this.webhookEvents.add(eventId);
  }

  getAuditEvents(): AuditEvent[] {
    return structuredClone(this.auditEvents);
  }
}
