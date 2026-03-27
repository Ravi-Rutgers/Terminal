import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { useStore } from '../../store';
import { colors, spacing, radius, fontSize as fs } from '../../constants/theme';

interface FileChange {
  file: string;
  status: string;       // 'M', 'A', 'D', '??', 'R', etc.
  statusLabel: string;
  added: number;
  deleted: number;
}

interface CommitInfo {
  hash: string;
  author: string;
  timeAgo: string;
  message: string;
}

function parseStatus(porcelain: string): { status: string; file: string }[] {
  if (!porcelain.trim()) return [];
  return porcelain.trim().split('\n').map((line) => {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    return { status, file };
  });
}

function parseNumstat(raw: string): Record<string, { added: number; deleted: number }> {
  const map: Record<string, { added: number; deleted: number }> = {};
  if (!raw.trim()) return map;
  for (const line of raw.trim().split('\n')) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      map[parts[2]] = { added, deleted };
    }
  }
  return map;
}

function parseLog(raw: string): CommitInfo | null {
  if (!raw.trim()) return null;
  const firstLine = raw.trim().split('\n')[0];
  const parts = firstLine.split('||');
  if (parts.length < 4) return null;
  return {
    hash: parts[0].substring(0, 7),
    author: parts[1],
    timeAgo: parts[2],
    message: parts[3],
  };
}

function statusColor(s: string): string {
  if (s === 'M' || s === 'MM') return colors.yellow;
  if (s === 'A' || s === 'AM') return colors.accent;
  if (s === 'D') return colors.red;
  if (s === '??') return colors.textMuted;
  if (s.startsWith('R')) return colors.purple;
  return colors.textMuted;
}

function statusIcon(s: string): string {
  if (s === 'M' || s === 'MM') return 'create-outline';
  if (s === 'A' || s === 'AM') return 'add-circle-outline';
  if (s === 'D') return 'remove-circle-outline';
  if (s === '??') return 'help-circle-outline';
  if (s.startsWith('R')) return 'swap-horizontal-outline';
  return 'ellipse-outline';
}

function statusLabel(s: string): string {
  if (s === 'M' || s === 'MM') return 'Gewijzigd';
  if (s === 'A' || s === 'AM') return 'Nieuw';
  if (s === 'D') return 'Verwijderd';
  if (s === '??') return 'Untracked';
  if (s.startsWith('R')) return 'Hernoemd';
  return s;
}

export default function ChangesScreen() {
  const { apiFetch } = useApi();
  const accentColor = useStore((s) => s.accentColor);
  const projectPath = useStore((s) => s.editorProjectPath);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const path = projectPath || '';

  // Fetch git status
  const { data: statusData, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['git-status', path],
    queryFn: () => apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch numstat for line counts
  const { data: numstatData, refetch: refetchNumstat } = useQuery({
    queryKey: ['git-numstat', path],
    queryFn: () => apiFetch(`/api/git/numstat?path=${encodeURIComponent(path)}`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch last commit
  const { data: logData, refetch: refetchLog } = useQuery({
    queryKey: ['git-log', path],
    queryFn: () => apiFetch(`/api/git/log?path=${encodeURIComponent(path)}&n=1`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch diff for expanded file
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['git-diff', path, expandedFile],
    queryFn: () => apiFetch(`/api/git/diff?path=${encodeURIComponent(path)}&file=${encodeURIComponent(expandedFile!)}`),
    enabled: !!path && !!expandedFile,
  });

  const onRefresh = useCallback(() => {
    refetchStatus();
    refetchNumstat();
    refetchLog();
  }, [refetchStatus, refetchNumstat, refetchLog]);

  // Parse data
  const statusFiles = statusData?.output ? parseStatus(statusData.output) : [];
  const unstagedStats = numstatData?.unstaged ? parseNumstat(numstatData.unstaged) : {};
  const stagedStats = numstatData?.staged ? parseNumstat(numstatData.staged) : {};
  const lastCommit = logData?.output ? parseLog(logData.output) : null;

  // Merge numstat into file changes
  const fileChanges: FileChange[] = statusFiles.map((f) => {
    const stats = unstagedStats[f.file] || stagedStats[f.file] || { added: 0, deleted: 0 };
    return {
      file: f.file,
      status: f.status,
      statusLabel: statusLabel(f.status),
      added: stats.added,
      deleted: stats.deleted,
    };
  });

  // Group by status type
  const groups = [
    { label: 'Gewijzigd', items: fileChanges.filter((f) => f.status === 'M' || f.status === 'MM') },
    { label: 'Nieuw', items: fileChanges.filter((f) => f.status === 'A' || f.status === 'AM') },
    { label: 'Verwijderd', items: fileChanges.filter((f) => f.status === 'D') },
    { label: 'Untracked', items: fileChanges.filter((f) => f.status === '??') },
    { label: 'Hernoemd', items: fileChanges.filter((f) => f.status.startsWith('R')) },
  ].filter((g) => g.items.length > 0);

  // Totals
  const totalAdded = fileChanges.reduce((s, f) => s + f.added, 0);
  const totalDeleted = fileChanges.reduce((s, f) => s + f.deleted, 0);

  if (!path) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="folder-open-outline" size={48} color={colors.textDim} />
        <Text style={styles.emptyText}>Selecteer eerst een project in de Editor tab</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={accentColor} />}
    >
      {/* Last commit */}
      {lastCommit && (
        <View style={styles.commitCard}>
          <View style={styles.commitHeader}>
            <Ionicons name="git-commit-outline" size={16} color={accentColor} />
            <Text style={styles.commitLabel}>Laatste commit</Text>
          </View>
          <Text style={styles.commitMessage} numberOfLines={2}>{lastCommit.message}</Text>
          <View style={styles.commitMeta}>
            <Text style={styles.commitHash}>{lastCommit.hash}</Text>
            <Text style={styles.commitDot}>&middot;</Text>
            <Text style={styles.commitAuthor}>{lastCommit.author}</Text>
            <Text style={styles.commitDot}>&middot;</Text>
            <Text style={styles.commitTime}>{lastCommit.timeAgo}</Text>
          </View>
        </View>
      )}

      {/* Summary bar */}
      {fileChanges.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryTotal}>{fileChanges.length} bestanden gewijzigd</Text>
          <View style={styles.summaryStats}>
            {totalAdded > 0 && (
              <View style={styles.statBadge}>
                <Text style={[styles.statText, { color: colors.accent }]}>+{totalAdded}</Text>
              </View>
            )}
            {totalDeleted > 0 && (
              <View style={styles.statBadge}>
                <Text style={[styles.statText, { color: colors.red }]}>-{totalDeleted}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Loading */}
      {statusLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={accentColor} />
        </View>
      )}

      {/* Clean state */}
      {!statusLoading && fileChanges.length === 0 && path && (
        <View style={styles.cleanCard}>
          <Ionicons name="checkmark-circle" size={40} color={colors.accent} />
          <Text style={styles.cleanText}>Working tree is clean</Text>
          <Text style={styles.cleanSub}>Geen uncommitted wijzigingen</Text>
        </View>
      )}

      {/* File groups */}
      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <View style={styles.groupHeader}>
            <Text style={[styles.groupLabel, { color: statusColor(group.items[0].status) }]}>
              {group.label}
            </Text>
            <View style={[styles.groupBadge, { backgroundColor: statusColor(group.items[0].status) + '20' }]}>
              <Text style={[styles.groupCount, { color: statusColor(group.items[0].status) }]}>
                {group.items.length}
              </Text>
            </View>
          </View>

          {group.items.map((file) => {
            const isExpanded = expandedFile === file.file;
            return (
              <View key={file.file}>
                <TouchableOpacity
                  style={[styles.fileRow, isExpanded && { backgroundColor: colors.elevated }]}
                  onPress={() => setExpandedFile(isExpanded ? null : file.file)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={statusIcon(file.status) as any}
                    size={16}
                    color={statusColor(file.status)}
                  />
                  <Text style={styles.fileName} numberOfLines={1}>
                    {file.file}
                  </Text>
                  <View style={styles.lineStats}>
                    {file.added > 0 && (
                      <Text style={styles.linesAdded}>+{file.added}</Text>
                    )}
                    {file.deleted > 0 && (
                      <Text style={styles.linesDeleted}>-{file.deleted}</Text>
                    )}
                  </View>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={colors.textDim}
                  />
                </TouchableOpacity>

                {/* Inline diff */}
                {isExpanded && (
                  <View style={styles.diffContainer}>
                    {diffLoading ? (
                      <ActivityIndicator color={accentColor} style={{ padding: 12 }} />
                    ) : diffData?.output ? (
                      <ScrollView horizontal>
                        <View>
                          {diffData.output.split('\n').map((line: string, i: number) => {
                            let bg = 'transparent';
                            let color = colors.textSecondary;
                            if (line.startsWith('+') && !line.startsWith('+++')) {
                              bg = colors.accent + '15';
                              color = colors.accent;
                            } else if (line.startsWith('-') && !line.startsWith('---')) {
                              bg = colors.red + '15';
                              color = colors.red;
                            } else if (line.startsWith('@@')) {
                              color = colors.purple;
                            }
                            return (
                              <Text
                                key={i}
                                style={[styles.diffLine, { backgroundColor: bg, color }]}
                              >
                                {line}
                              </Text>
                            );
                          })}
                        </View>
                      </ScrollView>
                    ) : (
                      <Text style={styles.diffEmpty}>Geen diff beschikbaar (nieuw/untracked bestand)</Text>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fs.body,
    textAlign: 'center',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },

  // Last commit
  commitCard: {
    backgroundColor: colors.elevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  commitHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  commitLabel: {
    color: colors.textMuted,
    fontSize: fs.caption,
    fontWeight: '600',
  },
  commitMessage: {
    color: colors.text,
    fontSize: fs.body,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  commitMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  commitHash: {
    color: colors.blue,
    fontSize: fs.caption,
    fontFamily: 'monospace',
  },
  commitDot: {
    color: colors.textDim,
    fontSize: fs.caption,
  },
  commitAuthor: {
    color: colors.textMuted,
    fontSize: fs.caption,
  },
  commitTime: {
    color: colors.textDim,
    fontSize: fs.caption,
  },

  // Summary
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  summaryTotal: {
    color: colors.textSecondary,
    fontSize: fs.standard,
    fontWeight: '600',
  },
  summaryStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.xs,
    backgroundColor: colors.elevated,
  },
  statText: {
    fontSize: fs.caption,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Clean state
  cleanCard: {
    alignItems: 'center',
    padding: 40,
    gap: spacing.sm,
  },
  cleanText: {
    color: colors.text,
    fontSize: fs.body,
    fontWeight: '600',
  },
  cleanSub: {
    color: colors.textMuted,
    fontSize: fs.caption,
  },

  // Groups
  group: {
    marginBottom: spacing.lg,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  groupLabel: {
    fontSize: fs.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  groupBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  groupCount: {
    fontSize: fs.micro,
    fontWeight: '700',
  },

  // File rows
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  fileName: {
    color: colors.text,
    fontSize: fs.standard,
    fontFamily: 'monospace',
    flex: 1,
  },
  lineStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linesAdded: {
    color: colors.accent,
    fontSize: fs.caption,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  linesDeleted: {
    color: colors.red,
    fontSize: fs.caption,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Diff
  diffContainer: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    maxHeight: 300,
  },
  diffLine: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
  diffEmpty: {
    color: colors.textDim,
    fontSize: fs.caption,
    fontStyle: 'italic',
    padding: spacing.sm,
  },
});
