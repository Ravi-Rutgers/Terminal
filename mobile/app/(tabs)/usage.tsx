import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, Clipboard } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { StatCard, UsageBar } from '../../components/UsageStats';
import { useApi } from '../../hooks/useApi';
import { useStore } from '../../store';

function formatResetTime(isoOrLabel: string): string {
  if (!isoOrLabel) return '';
  try {
    const d = new Date(isoOrLabel);
    return `Reset ${d.toLocaleDateString('nl-NL', { weekday: 'short' })} ${d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return isoOrLabel;
  }
}

export default function UsageScreen() {
  const { apiFetch } = useApi();
  const { sessions, setSystemInfo, serverUrl } = useStore();

  const {
    data: system,
    isLoading: sysLoading,
    refetch: refetchSys,
  } = useQuery({
    queryKey: ['system'],
    queryFn: async () => {
      const data = await apiFetch('/api/system');
      setSystemInfo(data);
      return data;
    },
    refetchInterval: 500,
  });

  const { data: agentStats, refetch: refetchStats } = useQuery({
    queryKey: ['usage-stats'],
    queryFn: () => apiFetch('/api/agents/stats'),
    refetchInterval: 10000,
  });

  const { data: agentSessions } = useQuery({
    queryKey: ['usage-sessions'],
    queryFn: () => apiFetch('/api/agents/sessions'),
    refetchInterval: 10000,
  });

  const { data: claudeUsage, error: claudeError } = useQuery({
    queryKey: ['claude-usage'],
    queryFn: () => apiFetch('/api/claude-usage'),
    refetchInterval: 30000,
    retry: false,
  });

  const sessionPct: number = claudeUsage?.five_hour?.utilization ?? 0;
  const sessionResetAt: string = claudeUsage?.five_hour?.resets_at ?? '';
  const weeklyPct: number = claudeUsage?.seven_day?.utilization ?? 0;
  const weeklyReset: string = claudeUsage?.seven_day?.resets_at ?? '';

  function minsUntil(iso: string): number {
    if (!iso) return 0;
    return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  }

  const onRefresh = () => {
    refetchSys();
    refetchStats();
  };

  // Calculate totals from all sessions (stats only shows current agent)
  const allSessions = agentSessions
    ? (Array.isArray(agentSessions) ? agentSessions : Object.values(agentSessions))
    : [];
  const totalTokens = allSessions.reduce((sum: number, s: any) => sum + (s.inputTokens || 0) + (s.outputTokens || 0), 0);
  const estimatedCost = allSessions.reduce((sum: number, s: any) => sum + (s.estimatedCost || 0), 0);
  const activeSessions = sessions.filter((s) => s.active).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={sysLoading} onRefresh={onRefresh} tintColor="#4ade80" />}
    >
      {/* Token & cost cards */}
      <Text style={styles.sectionTitle}>Claude API</Text>
      <View style={styles.row}>
        <StatCard
          label="Totale tokens"
          value={totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : String(totalTokens)}
          sub="input + output"
          color="#60a5fa"
        />
        <StatCard
          label="Geschatte kosten"
          value={`$${typeof estimatedCost === 'number' ? estimatedCost.toFixed(4) : '0.00'}`}
          sub="alle sessies"
          color="#facc15"
        />
      </View>

      {/* Claude usage limits */}
      <>
        <Text style={styles.sectionTitle}>Claude Limieten</Text>
        <View style={styles.systemCard}>
          {claudeError ? (
            <>
              <Text style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>
                Open dit adres in Chrome op je PC:
              </Text>
              <TouchableOpacity
                onPress={() => Clipboard.setString(`${serverUrl}/claude-push`)}
                style={{ backgroundColor: '#1e1e1e', borderRadius: 6, padding: 10, borderWidth: 1, borderColor: '#333' }}
              >
                <Text style={{ color: '#4ade80', fontSize: 12, fontFamily: 'monospace' }}>{serverUrl}/claude-push</Text>
                <Text style={{ color: '#555', fontSize: 10, marginTop: 4 }}>Tik om te kopiëren</Text>
              </TouchableOpacity>
            </>
          ) : claudeUsage ? (
              <>
                <UsageBar
                  label={`Sessie (reset over ${minsUntil(sessionResetAt)}min)`}
                  percent={sessionPct}
                  color={sessionPct > 80 ? '#f87171' : '#60a5fa'}
                />
                <UsageBar
                  label={`Wekelijks — ${formatResetTime(weeklyReset)}`}
                  percent={weeklyPct}
                  color={weeklyPct > 80 ? '#f87171' : '#4ade80'}
                />
              </>
          ) : (
            <Text style={{ color: '#666', fontSize: 12 }}>Laden...</Text>
          )}
        </View>
      </>

      {/* Active sessions */}
      <Text style={styles.sectionTitle}>Sessies</Text>
      <View style={styles.row}>
        <StatCard
          label="Actieve sessies"
          value={String(activeSessions)}
          sub={`${sessions.length} totaal`}
          color="#4ade80"
        />
        <StatCard
          label="Agents"
          value={String(agentStats?.total || 0)}
          sub={`${agentStats?.active || 0} actief`}
          color="#9c39ff"
        />
      </View>

      {/* System resources */}
      {system && (
        <>
          <Text style={styles.sectionTitle}>Systeem</Text>
          <View style={styles.systemCard}>
            <Text style={styles.cpuModel}>{system.cpu?.model}</Text>
            <Text style={styles.cpuCores}>{system.cpu?.cores} cores</Text>

            <UsageBar
              label="CPU"
              percent={system.cpu?.loadPercent || 0}
              color={system.cpu?.loadPercent > 80 ? '#f87171' : '#4ade80'}
            />
            <UsageBar
              label={`RAM (${system.memory?.usedGB?.toFixed(1)} / ${system.memory?.totalGB?.toFixed(1)} GB)`}
              percent={system.memory?.usedPercent || 0}
              color={system.memory?.usedPercent > 80 ? '#f87171' : '#60a5fa'}
            />
          </View>
        </>
      )}

      {/* Agent token breakdown */}
      {Array.isArray(agentSessions) && agentSessions.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Agent Token Gebruik</Text>
          {agentSessions.slice(0, 10).map((session: any, i: number) => (
            <View key={i} style={styles.agentRow}>
              <View style={styles.agentInfo}>
                <Text style={styles.agentId} numberOfLines={1}>
                  {session.id?.slice(0, 12) || `Sessie ${i + 1}`}
                </Text>
                <Text style={styles.agentModel}>{session.model || 'unknown'}</Text>
              </View>
              <View style={styles.agentTokens}>
                <Text style={styles.tokenCount}>
                  {((session.inputTokens || 0) + (session.outputTokens || 0)).toLocaleString()} tokens
                </Text>
                {session.estimatedCost != null && (
                  <Text style={styles.tokenCost}>${session.estimatedCost.toFixed(4)}</Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 12,
    paddingBottom: 40,
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    marginHorizontal: -4,
  },
  systemCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cpuModel: {
    color: '#e0e0e0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  cpuCores: {
    color: '#666',
    fontSize: 11,
    marginBottom: 12,
  },
  agentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  agentInfo: {
    flex: 1,
  },
  agentId: {
    color: '#e0e0e0',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  agentModel: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  agentTokens: {
    alignItems: 'flex-end',
  },
  tokenCount: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  tokenCost: {
    color: '#facc15',
    fontSize: 10,
    marginTop: 2,
  },
});
