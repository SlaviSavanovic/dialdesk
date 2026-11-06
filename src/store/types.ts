import type {
  Agent,
  AgentInput,
  Call,
  CallInput,
  Campaign,
  CampaignInput,
  CampaignStatus,
  DncEntry,
  Lead,
  LeadInput,
} from '../types.ts'

export interface CallFilter {
  campaignId?: number
  leadId?: number
  since?: string // ISO time
  limit?: number
}

// Nothing outside src/store knows SQLite exists. It's async so that a Postgres
// version could drop in later without touching the rest of the app.
export interface Store {
  listLeads(query?: string): Promise<Lead[]>
  getLead(id: number): Promise<Lead | null>
  // Phone is the identity of a lead, so importing the same number updates it.
  upsertLead(input: LeadInput, now: string): Promise<{ lead: Lead; created: boolean }>
  updateLead(id: number, patch: Partial<LeadInput>): Promise<Lead | null>
  deleteLead(id: number): Promise<void>

  listAgents(): Promise<Agent[]>
  getAgent(id: number): Promise<Agent | null>
  createAgent(input: AgentInput, now: string): Promise<Agent>
  updateAgent(id: number, patch: Partial<AgentInput>, now: string): Promise<Agent | null>
  deleteAgent(id: number): Promise<void>

  listCampaigns(): Promise<Campaign[]>
  getCampaign(id: number): Promise<Campaign | null>
  createCampaign(input: CampaignInput, now: string): Promise<Campaign>
  updateCampaign(id: number, patch: Partial<CampaignInput>): Promise<Campaign | null>
  deleteCampaign(id: number): Promise<void>
  setCampaignStatus(id: number, status: CampaignStatus): Promise<void>
  addCampaignLeads(campaignId: number, leadIds: number[]): Promise<void>
  removeCampaignLeads(campaignId: number, leadIds: number[]): Promise<void>
  campaignLeads(campaignId: number): Promise<Lead[]>

  createCall(input: CallInput): Promise<Call>
  updateCall(id: number, patch: Partial<Call>): Promise<Call>
  getCall(id: number): Promise<Call | null>
  listCalls(filter?: CallFilter): Promise<Call[]>
  openCalls(): Promise<Call[]>
  // Campaign calls to this number, oldest first. Test calls are left out.
  callsForPhone(phone: string): Promise<Call[]>
  countCampaignCallsSince(campaignId: number, since: string): Promise<number>
  countTestCallsSince(since: string): Promise<number>

  isOnDnc(phone: string): Promise<boolean>
  addDnc(entry: DncEntry): Promise<void>
  listDnc(): Promise<DncEntry[]>

  getSetting<T>(key: string, fallback: T): Promise<T>
  setSetting(key: string, value: unknown): Promise<void>
}
