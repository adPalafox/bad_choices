export type GamePhase = "lobby" | "voting" | "reveal" | "ended";
export type ResolutionType = "majority" | "indecision_tie" | "indecision_no_vote";
export type ScenarioNodeKind = "core" | "wildcard" | "audience_intervention" | "special_event" | "ending";

export type ModifierGate = {
  requiredModifiers?: string[];
  blockedModifiers?: string[];
  minChaosMoments?: number;
  maxChaosMoments?: number;
  requiredVisitedNodeIds?: string[];
  blockedVisitedNodeIds?: string[];
};

export type TextVariant = {
  text: string;
  gate?: ModifierGate;
};

export type ChoiceEffect = {
  type: "add_modifier" | "remove_modifier";
  modifierId: string;
};

export type Choice = {
  id: string;
  label: string;
  nextNodeId: string;
  resultText?: string;
  gate?: ModifierGate;
  effects?: ChoiceEffect[];
  wildcardNodeIds?: string[];
  specialEventNodeIds?: string[];
  labelVariants?: TextVariant[];
};

export type ScenarioNode = {
  id: string;
  prompt: string;
  resultText?: string;
  ending?: boolean;
  kind?: ScenarioNodeKind;
  gate?: ModifierGate;
  promptVariants?: TextVariant[];
  audienceInterventionNodeIds?: string[];
  wildcardChance?: number;
  specialEventChance?: number;
  choices: Choice[];
};

export type ScenarioPack = {
  packId: string;
  title: string;
  theme: string;
  startNodeId: string;
  nodes: ScenarioNode[];
  modifiers?: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

export type RoomRecord = {
  id: string;
  code: string;
  host_session_id: string;
  status: "lobby" | "active" | "ended";
  scenario_pack: string;
  phase: GamePhase;
  round: number;
  current_node_id: string | null;
  pending_node_id: string | null;
  phase_deadline: string | null;
  created_at: string;
};

export type PlayerRecord = {
  id: string;
  room_id: string;
  session_id: string;
  nickname: string;
  is_host: boolean;
  connected: boolean;
  joined_at: string;
};

export type PublicPlayer = Omit<PlayerRecord, "session_id">;

export type VoteRecord = {
  id: string;
  room_id: string;
  player_id: string;
  round: number;
  node_id: string;
  selected_choice_id: string;
  created_at: string;
};

export type GameEventRecord = {
  id: string;
  room_id: string;
  round: number;
  node_id: string;
  prompt: string;
  selected_choice_id: string;
  selected_choice_label: string;
  next_node_id: string;
  result_text: string;
  resolution_type: ResolutionType;
  resolution_label: string;
  vote_snapshot: Record<string, number>;
  created_at: string;
};

export type ApiRoomState = {
  room: RoomRecord;
  pack: ScenarioPack;
  players: PublicPlayer[];
  votes: VoteRecord[];
  events: GameEventRecord[];
  currentNode: ScenarioNode | null;
  pendingNode: ScenarioNode | null;
  lastEvent: GameEventRecord | null;
};

export type RoomSession = {
  sessionId: string;
  playerId: string;
  nickname: string;
};
