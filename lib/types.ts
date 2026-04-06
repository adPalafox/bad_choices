export type GamePhase = "lobby" | "private_input" | "voting" | "reveal" | "ended";
export type ResolutionType = "majority" | "indecision_tie" | "indecision_no_vote";
export type ScenarioNodeKind = "core" | "wildcard" | "audience_intervention" | "special_event" | "ending";
export type SocialResolutionType = "majority" | "split" | "silence";
export type RoundTemplateId = "scapegoat" | "prediction" | "confession";
export type PrivateInputType = "player_target" | "choice_option";

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

export type SocialPromptConfig = {
  key: string;
  prompt: string;
  voteIntro: string;
  receiptTemplate?: string;
};

export type PrivateOption = {
  id: string;
  label: string;
};

export type RoundTemplateConfig = {
  id: RoundTemplateId;
  privateInputType?: PrivateInputType;
  privatePrompt?: string;
  voteIntro?: string;
  receiptTemplate?: string;
  distributionIntro?: string;
  confessionOptions?: PrivateOption[];
  betrayalEligible?: boolean;
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
  socialPrompt?: SocialPromptConfig;
  roundTemplate?: RoundTemplateConfig;
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

export type PrivateSubmissionRecord = {
  id: string;
  room_id: string;
  player_id: string;
  round: number;
  node_id: string;
  prompt_key: string;
  target_player_id: string | null;
  selected_option_id: string | null;
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
  template_id: RoundTemplateId;
  spotlight_player_id: string | null;
  spotlight_label: string | null;
  private_vote_snapshot: Record<string, number>;
  instigator_player_ids: string[];
  private_resolution_type: SocialResolutionType;
  leading_private_option_id: string | null;
  leading_private_option_label: string | null;
  distribution_line: string | null;
  power_holder_player_id: string | null;
  power_holder_label: string | null;
  power_altered_outcome: boolean;
  consequence_line: string;
  receipt_line: string;
  created_at: string;
};

export type CurrentRoundContext = {
  templateId: RoundTemplateId;
  privateInputType: PrivateInputType;
  promptKey: string;
  privatePrompt: string;
  voteIntro: string;
  spotlightPlayerId: string | null;
  spotlightLabel: string | null;
  privateVoteSnapshot: Record<string, number>;
  instigatorPlayerIds: string[];
  privateResolutionType: SocialResolutionType;
  privateOptions: PrivateOption[];
  leadingPrivateOptionId: string | null;
  leadingPrivateOptionLabel: string | null;
  distributionLine: string | null;
  betrayalActive: boolean;
};

export type ApiRoomState = {
  room: RoomRecord;
  pack: ScenarioPack;
  players: PublicPlayer[];
  privateSubmissions: PrivateSubmissionRecord[];
  votes: VoteRecord[];
  events: GameEventRecord[];
  currentNode: ScenarioNode | null;
  pendingNode: ScenarioNode | null;
  lastEvent: GameEventRecord | null;
  currentRoundContext: CurrentRoundContext | null;
};

export type RoomSession = {
  sessionId: string;
  playerId: string;
  nickname: string;
};
