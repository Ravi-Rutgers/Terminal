import { create } from 'zustand';

export interface TerminalSession {
  id: string;
  title: string;
  workdir: string;
  active: boolean;
  createdAt: string;
}

export interface Agent {
  id: string;
  sessionId: string;
  name: string;
  project: string;
  status: string;
  type: string;
  model: string;
  avatarIndex: number;
  currentTool: string | null;
  lastMessage: string | null;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  metadata: {
    isSubagent: boolean;
    isTeammate: boolean;
    projectPath: string | null;
    parentId: string | null;
    permissionMode: string;
  };
  timing: {
    elapsed: number;
    active: boolean;
  };
}

export interface SystemInfo {
  cpu: { model: string; cores: number; loadPercent: number };
  memory: { totalGB: number; usedGB: number; usedPercent: number };
}

interface AppState {
  serverUrl: string;
  token: string | null;
  sessions: TerminalSession[];
  activeSessionId: string | null;
  agents: Agent[];
  systemInfo: SystemInfo | null;
  accentColor: string;
  githubToken: string | null;
  agentSessionMap: Record<string, string>; // agentId -> sessionId
  terminalFontSize: number;
  editorProjectPath: string | null;
  editorCurrentDir: string;
  editorOpenFile: { path: string; name: string; language: string } | null;
  editorMode: 'browse' | 'tree' | 'editor';

  setServerUrl: (url: string) => void;
  setToken: (token: string | null) => void;
  setSessions: (sessions: TerminalSession[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  setAgents: (agents: Agent[]) => void;
  setSystemInfo: (info: SystemInfo) => void;
  setAccentColor: (color: string) => void;
  setGithubToken: (token: string | null) => void;
  setAgentSession: (agentId: string, sessionId: string) => void;
  setTerminalFontSize: (size: number) => void;
  setEditorProjectPath: (path: string | null) => void;
  setEditorCurrentDir: (dir: string) => void;
  setEditorOpenFile: (file: { path: string; name: string; language: string } | null) => void;
  setEditorMode: (mode: 'browse' | 'tree' | 'editor') => void;
}

export const useStore = create<AppState>((set) => ({
  serverUrl: '',
  token: null,
  sessions: [],
  activeSessionId: null,
  agents: [],
  systemInfo: null,
  accentColor: '#4ade80',
  githubToken: null,
  agentSessionMap: {},
  terminalFontSize: 14,
  editorProjectPath: null,
  editorCurrentDir: '',
  editorOpenFile: null,
  editorMode: 'browse',

  setServerUrl: (url) => set({ serverUrl: url }),
  setToken: (token) => set({ token }),
  setSessions: (sessions) => set({ sessions }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),
  setAgents: (agents) => set({ agents }),
  setSystemInfo: (info) => set({ systemInfo: info }),
  setAccentColor: (color) => set({ accentColor: color }),
  setGithubToken: (token) => set({ githubToken: token }),
  setAgentSession: (agentId, sessionId) =>
    set((state) => ({ agentSessionMap: { ...state.agentSessionMap, [agentId]: sessionId } })),
  setTerminalFontSize: (size) => set({ terminalFontSize: size }),
  setEditorProjectPath: (path) => set({ editorProjectPath: path }),
  setEditorCurrentDir: (dir) => set({ editorCurrentDir: dir }),
  setEditorOpenFile: (file) => set({ editorOpenFile: file }),
  setEditorMode: (mode) => set({ editorMode: mode }),
}));

export function getAgentSession(agentId: string): string | null {
  return useStore.getState().agentSessionMap[agentId] || null;
}
