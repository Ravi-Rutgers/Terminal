import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Alert,
  Modal,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../hooks/useApi';
import { useStore } from '../../store';
import { colors, spacing, radius, fontSize as fs } from '../../constants/theme';
import GitTerminal, { GitTerminalHandle } from '../../components/GitTerminal';
import BranchSelector from '../../components/BranchSelector';
import GitActionsMenu from '../../components/GitActionsMenu';

interface FileChange {
  file: string;
  status: string;
  indexStatus: string;
  workStatus: string;
  statusLabel: string;
  added: number;
  deleted: number;
  staged: boolean;
}

interface CommitInfo {
  hash: string;
  author: string;
  timeAgo: string;
  message: string;
}

interface StashItem {
  index: number;
  message: string;
}

interface TagItem {
  name: string;
  hash: string;
  date: string;
  message: string;
}

function parseStatus(porcelain: string): { indexStatus: string; workStatus: string; file: string }[] {
  if (!porcelain.trim()) return [];
  return porcelain.trim().split('\n').map((line) => {
    const indexStatus = line[0];
    const workStatus = line[1];
    const file = line.substring(3);
    return { indexStatus, workStatus, file };
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

function parseBranches(raw: string): { name: string; hash: string; upstream: string; current: boolean }[] {
  if (!raw.trim()) return [];
  return raw.trim().split('\n').map((line) => {
    const parts = line.split('||');
    return {
      name: parts[0] || '',
      hash: parts[1] || '',
      upstream: parts[2] || '',
      current: parts[3] === '*',
    };
  }).filter(b => b.name);
}

function parseStashes(raw: string): StashItem[] {
  if (!raw.trim()) return [];
  return raw.trim().split('\n').map((line, i) => {
    const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/);
    return {
      index: match ? parseInt(match[1], 10) : i,
      message: match ? match[2] : line,
    };
  });
}

function parseTags(raw: string): TagItem[] {
  if (!raw.trim()) return [];
  return raw.trim().split('\n').map((line) => {
    const parts = line.split('||');
    return {
      name: parts[0] || '',
      hash: parts[1] || '',
      date: parts[2] || '',
      message: parts[3] || '',
    };
  }).filter(t => t.name);
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

function getDisplayStatus(indexStatus: string, workStatus: string): string {
  if (indexStatus === '?' && workStatus === '?') return '??';
  if (workStatus !== ' ' && workStatus !== '?') return workStatus;
  return indexStatus;
}

export default function ChangesScreen() {
  const { apiFetch } = useApi();
  const queryClient = useQueryClient();
  const accentColor = useStore((s) => s.accentColor);
  const projectPath = useStore((s) => s.editorProjectPath);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedFileStaged, setExpandedFileStaged] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [amendMode, setAmendMode] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [diffModalFile, setDiffModalFile] = useState<{ file: string; staged: boolean } | null>(null);
  const gitTerminalRef = useRef<GitTerminalHandle>(null);

  const path = projectPath || '';

  const refetchAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['git-status', path] });
    queryClient.invalidateQueries({ queryKey: ['git-numstat', path] });
    queryClient.invalidateQueries({ queryKey: ['git-log', path] });
    queryClient.invalidateQueries({ queryKey: ['git-branches', path] });
    queryClient.invalidateQueries({ queryKey: ['git-current-branch', path] });
    queryClient.invalidateQueries({ queryKey: ['git-stash', path] });
    queryClient.invalidateQueries({ queryKey: ['git-tags', path] });
  }, [queryClient, path]);

  // Fetch git status
  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ['git-status', path],
    queryFn: () => apiFetch(`/api/git/status?path=${encodeURIComponent(path)}`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch numstat
  const { data: numstatData } = useQuery({
    queryKey: ['git-numstat', path],
    queryFn: () => apiFetch(`/api/git/numstat?path=${encodeURIComponent(path)}`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch last commit
  const { data: logData } = useQuery({
    queryKey: ['git-log', path],
    queryFn: () => apiFetch(`/api/git/log?path=${encodeURIComponent(path)}&n=1`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch current branch
  const { data: branchData } = useQuery({
    queryKey: ['git-current-branch', path],
    queryFn: () => apiFetch(`/api/git/current-branch?path=${encodeURIComponent(path)}`),
    enabled: !!path,
    refetchInterval: 10000,
  });

  // Fetch branches
  const { data: branchesData } = useQuery({
    queryKey: ['git-branches', path],
    queryFn: () => apiFetch(`/api/git/branches?path=${encodeURIComponent(path)}`),
    enabled: !!path,
  });

  // Fetch stashes
  const { data: stashData } = useQuery({
    queryKey: ['git-stash', path],
    queryFn: () => apiFetch(`/api/git/stash/list?path=${encodeURIComponent(path)}`),
    enabled: !!path,
  });

  // Fetch tags
  const { data: tagsData } = useQuery({
    queryKey: ['git-tags', path],
    queryFn: () => apiFetch(`/api/git/tags?path=${encodeURIComponent(path)}`),
    enabled: !!path,
  });

  // Helper: fetch diff, fallback to file content for untracked/new files
  const fetchDiffOrContent = useCallback(async (file: string, staged: boolean) => {
    const endpoint = staged ? '/api/git/diff-staged' : '/api/git/diff';
    const result = await apiFetch(`${endpoint}?path=${encodeURIComponent(path)}&file=${encodeURIComponent(file)}`);
    if (result?.output?.trim()) return result;
    // Fallback: read file content for untracked/new files
    try {
      const filePath = path.replace(/\\/g, '/') + '/' + file;
      const content = await apiFetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (content?.content) {
        const lines = content.content.split('\n').map((l: string) => '+' + l).join('\n');
        return { output: `@@ nieuw bestand @@\n${lines}`, isNewFile: true };
      }
    } catch {}
    return result;
  }, [apiFetch, path]);

  // Fetch diff for expanded file
  const { data: diffData, isLoading: diffLoading } = useQuery({
    queryKey: ['git-diff', path, expandedFile, expandedFileStaged],
    queryFn: () => fetchDiffOrContent(expandedFile!, expandedFileStaged),
    enabled: !!path && !!expandedFile,
  });

  // Fetch diff for modal (full view)
  const { data: modalDiffData, isLoading: modalDiffLoading } = useQuery({
    queryKey: ['git-diff-modal', path, diffModalFile?.file, diffModalFile?.staged],
    queryFn: () => fetchDiffOrContent(diffModalFile!.file, diffModalFile!.staged),
    enabled: !!path && !!diffModalFile,
  });

  const onRefresh = useCallback(() => {
    refetchAll();
  }, [refetchAll]);

  // Parse data
  const statusFiles = statusData?.output ? parseStatus(statusData.output) : [];
  const unstagedStats = numstatData?.unstaged ? parseNumstat(numstatData.unstaged) : {};
  const stagedStats = numstatData?.staged ? parseNumstat(numstatData.staged) : {};
  const lastCommit = logData?.output ? parseLog(logData.output) : null;
  const currentBranch = branchData?.output?.trim() || '';
  const allBranches = branchesData?.output ? parseBranches(branchesData.output) : [];
  const branchNames = allBranches.map(b => b.name);
  const stashes = stashData?.output ? parseStashes(stashData.output) : [];
  const tags = tagsData?.output ? parseTags(tagsData.output) : [];

  // Build file changes with staging info
  const fileChanges: FileChange[] = statusFiles.map((f) => {
    const displayStatus = getDisplayStatus(f.indexStatus, f.workStatus);
    const stats = unstagedStats[f.file] || stagedStats[f.file] || { added: 0, deleted: 0 };
    const isStaged = f.indexStatus !== ' ' && f.indexStatus !== '?';
    return {
      file: f.file,
      status: displayStatus,
      indexStatus: f.indexStatus,
      workStatus: f.workStatus,
      statusLabel: statusLabel(displayStatus),
      added: stats.added,
      deleted: stats.deleted,
      staged: isStaged,
    };
  });

  const stagedFiles = fileChanges.filter(f => f.staged);
  const unstagedFiles = fileChanges.filter(f => !f.staged);
  const totalAdded = fileChanges.reduce((s, f) => s + f.added, 0);
  const totalDeleted = fileChanges.reduce((s, f) => s + f.deleted, 0);

  // --- Actions ---
  const stageFile = useCallback(async (file: string) => {
    try {
      await apiFetch('/api/git/add', { method: 'POST', body: JSON.stringify({ path, files: [file] }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Fout', e.message); }
  }, [apiFetch, path, refetchAll]);

  const unstageFile = useCallback(async (file: string) => {
    try {
      await apiFetch('/api/git/unstage', { method: 'POST', body: JSON.stringify({ path, files: [file] }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Fout', e.message); }
  }, [apiFetch, path, refetchAll]);

  const stageAll = useCallback(async () => {
    try {
      await apiFetch('/api/git/add-all', { method: 'POST', body: JSON.stringify({ path }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Fout', e.message); }
  }, [apiFetch, path, refetchAll]);

  const unstageAll = useCallback(async () => {
    try {
      const files = stagedFiles.map(f => f.file);
      if (files.length === 0) return;
      await apiFetch('/api/git/unstage', { method: 'POST', body: JSON.stringify({ path, files }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Fout', e.message); }
  }, [apiFetch, path, stagedFiles, refetchAll]);

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() && !amendMode) return;
    setCommitting(true);
    try {
      await apiFetch('/api/git/commit', { method: 'POST', body: JSON.stringify({ path, message: commitMessage.trim(), amend: amendMode }) });
      setCommitMessage('');
      setAmendMode(false);
      refetchAll();
    } catch (e: any) { Alert.alert('Commit mislukt', e.message); }
    finally { setCommitting(false); }
  }, [apiFetch, path, commitMessage, amendMode, refetchAll]);

  const handleFetch = useCallback(async () => {
    try {
      await apiFetch('/api/git/fetch', { method: 'POST', body: JSON.stringify({ path }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Fetch mislukt', e.message); }
  }, [apiFetch, path, refetchAll]);

  const handlePush = useCallback(() => {
    setShowTerminal(true);
    setTimeout(() => gitTerminalRef.current?.runCommand('git push'), 1000);
  }, []);

  const handlePull = useCallback(() => {
    setShowTerminal(true);
    setTimeout(() => gitTerminalRef.current?.runCommand('git pull'), 1000);
  }, []);

  const handleCheckout = useCallback(async (branch: string) => {
    setActionsLoading(true);
    try {
      await apiFetch('/api/git/checkout', { method: 'POST', body: JSON.stringify({ path, branch }) });
      refetchAll();
      setShowBranches(false);
    } catch (e: any) { Alert.alert('Checkout mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleCreateBranch = useCallback(async (name: string, base?: string) => {
    setActionsLoading(true);
    try {
      await apiFetch('/api/git/branch/create', { method: 'POST', body: JSON.stringify({ path, name, base }) });
      refetchAll();
      setShowBranches(false);
    } catch (e: any) { Alert.alert('Branch aanmaken mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleDeleteBranch = useCallback(async (name: string) => {
    setActionsLoading(true);
    try {
      await apiFetch(`/api/git/branch?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      refetchAll();
    } catch (e: any) { Alert.alert('Verwijderen mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleStash = useCallback(async (message?: string) => {
    setActionsLoading(true);
    try {
      await apiFetch('/api/git/stash', { method: 'POST', body: JSON.stringify({ path, message }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Stash mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleStashPop = useCallback(async (index?: number) => {
    setActionsLoading(true);
    try {
      await apiFetch('/api/git/stash/pop', { method: 'POST', body: JSON.stringify({ path, index }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Stash pop mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleStashDrop = useCallback(async (index: number) => {
    setActionsLoading(true);
    try {
      await apiFetch(`/api/git/stash?path=${encodeURIComponent(path)}&index=${index}`, { method: 'DELETE' });
      refetchAll();
    } catch (e: any) { Alert.alert('Stash drop mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleMerge = useCallback((branch: string) => {
    setShowActions(false);
    setShowTerminal(true);
    setTimeout(() => gitTerminalRef.current?.runCommand(`git merge ${branch}`), 1000);
  }, []);

  const handleCreateTag = useCallback(async (name: string, message?: string) => {
    setActionsLoading(true);
    try {
      await apiFetch('/api/git/tag', { method: 'POST', body: JSON.stringify({ path, name, message }) });
      refetchAll();
    } catch (e: any) { Alert.alert('Tag aanmaken mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  const handleDeleteTag = useCallback(async (name: string) => {
    setActionsLoading(true);
    try {
      await apiFetch(`/api/git/tag?path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      refetchAll();
    } catch (e: any) { Alert.alert('Tag verwijderen mislukt', e.message); }
    finally { setActionsLoading(false); }
  }, [apiFetch, path, refetchAll]);

  // --- Render file row ---
  const renderFileRow = (file: FileChange) => {
    const isExpanded = expandedFile === file.file;
    return (
      <View key={file.file}>
        <View style={styles.fileRow}>
          <TouchableOpacity
            style={styles.stageCheckbox}
            onPress={() => file.staged ? unstageFile(file.file) : stageFile(file.file)}
          >
            <Ionicons
              name={file.staged ? 'checkbox' : 'square-outline'}
              size={18}
              color={file.staged ? accentColor : colors.textDim}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.fileInfo}
            onPress={() => {
              setExpandedFile(isExpanded ? null : file.file);
              setExpandedFileStaged(file.staged);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name={statusIcon(file.status) as any} size={16} color={statusColor(file.status)} />
            <Text style={[styles.fileName, file.staged && { color: accentColor }]} numberOfLines={1}>
              {file.file}
            </Text>
            <View style={styles.lineStats}>
              {file.added > 0 && <Text style={styles.linesAdded}>+{file.added}</Text>}
              {file.deleted > 0 && <Text style={styles.linesDeleted}>-{file.deleted}</Text>}
            </View>
            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textDim} />
          </TouchableOpacity>
        </View>

        {isExpanded && (
          <View style={styles.diffContainer}>
            {diffLoading ? (
              <ActivityIndicator color={accentColor} style={{ padding: 12 }} />
            ) : diffData?.output ? (
              <>
                <TouchableOpacity
                  style={styles.diffExpandBtn}
                  onPress={() => setDiffModalFile({ file: file.file, staged: file.staged })}
                >
                  <Ionicons name="expand-outline" size={14} color={accentColor} />
                  <Text style={[styles.diffExpandText, { color: accentColor }]}>Volledig bekijken</Text>
                </TouchableOpacity>
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
                        <Text key={i} style={[styles.diffLine, { backgroundColor: bg, color }]}>{line}</Text>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            ) : (
              <Text style={styles.diffEmpty}>Geen diff beschikbaar (nieuw/untracked bestand)</Text>
            )}
          </View>
        )}
      </View>
    );
  };

  if (!path) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="folder-open-outline" size={48} color={colors.textDim} />
        <Text style={styles.emptyText}>Selecteer eerst een project in de Editor tab</Text>
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={accentColor} />}
        contentContainerStyle={{ paddingBottom: showTerminal ? 200 : 40 }}
      >
        {/* Header bar */}
        <View style={styles.headerBar}>
          <TouchableOpacity style={styles.branchChip} onPress={() => setShowBranches(true)}>
            <Ionicons name="git-branch-outline" size={14} color={accentColor} />
            <Text style={[styles.branchName, { color: accentColor }]} numberOfLines={1}>
              {currentBranch || '...'}
            </Text>
            <Ionicons name="chevron-down" size={12} color={accentColor} />
          </TouchableOpacity>
          <View style={styles.syncButtons}>
            <TouchableOpacity style={styles.syncBtn} onPress={handleFetch}>
              <Ionicons name="cloud-download-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.syncBtn} onPress={handlePull}>
              <Ionicons name="arrow-down-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.syncBtn} onPress={handlePush}>
              <Ionicons name="arrow-up-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.syncBtn} onPress={() => setShowActions(true)}>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

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
            <Text style={styles.summaryTotal}>{fileChanges.length} bestanden</Text>
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
            <View style={styles.stageActions}>
              <TouchableOpacity style={styles.stageActionBtn} onPress={stageAll}>
                <Text style={[styles.stageActionText, { color: accentColor }]}>Stage alles</Text>
              </TouchableOpacity>
              {stagedFiles.length > 0 && (
                <TouchableOpacity style={styles.stageActionBtn} onPress={unstageAll}>
                  <Text style={[styles.stageActionText, { color: colors.yellow }]}>Unstage</Text>
                </TouchableOpacity>
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

        {/* Staged files */}
        {stagedFiles.length > 0 && (
          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <Ionicons name="checkmark-circle" size={14} color={accentColor} />
              <Text style={[styles.groupLabel, { color: accentColor }]}>Staged</Text>
              <View style={[styles.groupBadge, { backgroundColor: accentColor + '20' }]}>
                <Text style={[styles.groupCount, { color: accentColor }]}>{stagedFiles.length}</Text>
              </View>
            </View>
            {stagedFiles.map(renderFileRow)}
          </View>
        )}

        {/* Unstaged files */}
        {unstagedFiles.length > 0 && (
          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.groupLabel, { color: colors.textMuted }]}>Wijzigingen</Text>
              <View style={[styles.groupBadge, { backgroundColor: colors.textMuted + '20' }]}>
                <Text style={[styles.groupCount, { color: colors.textMuted }]}>{unstagedFiles.length}</Text>
              </View>
            </View>
            {unstagedFiles.map(renderFileRow)}
          </View>
        )}

        {/* Commit input area */}
        {(stagedFiles.length > 0 || amendMode) && (
          <View style={styles.commitArea}>
            <TextInput
              style={styles.commitInput}
              placeholder="Commit bericht..."
              placeholderTextColor={colors.textDim}
              value={commitMessage}
              onChangeText={setCommitMessage}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.commitActions}>
              <TouchableOpacity
                style={[styles.commitBtn, { backgroundColor: (commitMessage.trim() || amendMode) ? accentColor : colors.elevated }]}
                onPress={handleCommit}
                disabled={committing || (!commitMessage.trim() && !amendMode)}
              >
                {committing ? (
                  <ActivityIndicator color={colors.bg} size="small" />
                ) : (
                  <Text style={[styles.commitBtnText, { color: (commitMessage.trim() || amendMode) ? colors.bg : colors.textDim }]}>
                    {amendMode ? 'Amend' : 'Commit'}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.amendToggle, amendMode && { backgroundColor: colors.yellow + '20', borderColor: colors.yellow }]}
                onPress={() => setAmendMode(!amendMode)}
              >
                <Text style={[styles.amendText, amendMode && { color: colors.yellow }]}>Amend</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Terminal FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: accentColor }]}
        onPress={() => setShowTerminal(!showTerminal)}
      >
        <Ionicons name="terminal" size={22} color={colors.bg} />
      </TouchableOpacity>

      {/* Git Terminal */}
      <GitTerminal
        ref={gitTerminalRef}
        projectPath={path}
        visible={showTerminal}
        onClose={() => setShowTerminal(false)}
      />

      {/* Branch Selector */}
      <BranchSelector
        visible={showBranches}
        onClose={() => setShowBranches(false)}
        branches={branchNames}
        currentBranch={currentBranch}
        onCheckout={handleCheckout}
        onCreate={handleCreateBranch}
        onDelete={handleDeleteBranch}
        loading={actionsLoading}
      />

      {/* Diff Modal */}
      <Modal
        visible={!!diffModalFile}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setDiffModalFile(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setDiffModalFile(null)} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle} numberOfLines={1}>{diffModalFile?.file}</Text>
              {diffModalFile?.staged && (
                <View style={[styles.modalStagedBadge, { backgroundColor: accentColor + '20' }]}>
                  <Text style={[styles.modalStagedText, { color: accentColor }]}>Staged</Text>
                </View>
              )}
            </View>
          </View>
          {modalDiffLoading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={accentColor} size="large" />
            </View>
          ) : modalDiffData?.output ? (
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
              <ScrollView horizontal>
                <View>
                  {modalDiffData.output.split('\n').map((line: string, i: number) => {
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
                      <Text key={i} style={[styles.modalDiffLine, { backgroundColor: bg, color }]}>
                        <Text style={styles.modalLineNum}>{String(i + 1).padStart(4, ' ')}  </Text>
                        {line}
                      </Text>
                    );
                  })}
                </View>
              </ScrollView>
            </ScrollView>
          ) : (
            <View style={styles.modalLoading}>
              <Text style={styles.diffEmpty}>Geen diff beschikbaar (nieuw/untracked bestand)</Text>
            </View>
          )}
        </View>
      </Modal>

      {/* Git Actions Menu */}
      <GitActionsMenu
        visible={showActions}
        onClose={() => setShowActions(false)}
        stashes={stashes}
        onStash={handleStash}
        onStashPop={handleStashPop}
        onStashDrop={handleStashDrop}
        branches={branchNames}
        currentBranch={currentBranch}
        onMerge={handleMerge}
        tags={tags}
        onCreateTag={handleCreateTag}
        onDeleteTag={handleDeleteTag}
        loading={actionsLoading}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  emptyContainer: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', gap: spacing.md, padding: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: fs.body, textAlign: 'center' },
  loadingContainer: { padding: 40, alignItems: 'center' },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  branchChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.elevated, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.borderStrong, flex: 1, marginRight: spacing.md },
  branchName: { fontSize: fs.standard, fontWeight: '600', flex: 1 },
  syncButtons: { flexDirection: 'row', gap: 4 },
  syncBtn: { padding: spacing.sm, backgroundColor: colors.elevated, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong },
  commitCard: { backgroundColor: colors.elevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.lg, marginBottom: spacing.lg },
  commitHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  commitLabel: { color: colors.textMuted, fontSize: fs.caption, fontWeight: '600' },
  commitMessage: { color: colors.text, fontSize: fs.body, fontWeight: '600', marginBottom: spacing.sm },
  commitMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  commitHash: { color: colors.blue, fontSize: fs.caption, fontFamily: 'monospace' },
  commitDot: { color: colors.textDim, fontSize: fs.caption },
  commitAuthor: { color: colors.textMuted, fontSize: fs.caption },
  commitTime: { color: colors.textDim, fontSize: fs.caption },
  summaryBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.xs, gap: spacing.sm },
  summaryTotal: { color: colors.textSecondary, fontSize: fs.standard, fontWeight: '600' },
  summaryStats: { flexDirection: 'row', gap: spacing.sm },
  statBadge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: colors.elevated },
  statText: { fontSize: fs.caption, fontWeight: '700', fontFamily: 'monospace' },
  stageActions: { flexDirection: 'row', gap: spacing.sm, marginLeft: 'auto' },
  stageActionBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
  stageActionText: { fontSize: fs.caption, fontWeight: '700' },
  cleanCard: { alignItems: 'center', padding: 40, gap: spacing.sm },
  cleanText: { color: colors.text, fontSize: fs.body, fontWeight: '600' },
  cleanSub: { color: colors.textMuted, fontSize: fs.caption },
  group: { marginBottom: spacing.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  groupLabel: { fontSize: fs.caption, fontWeight: '700', letterSpacing: 0.5 },
  groupBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.xs },
  groupCount: { fontSize: fs.micro, fontWeight: '700' },
  fileRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, paddingRight: spacing.sm },
  stageCheckbox: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginRight: 2 },
  fileInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: radius.sm },
  fileName: { color: colors.text, fontSize: fs.standard, fontFamily: 'monospace', flex: 1 },
  lineStats: { flexDirection: 'row', gap: spacing.sm },
  linesAdded: { color: colors.accent, fontSize: fs.caption, fontWeight: '700', fontFamily: 'monospace' },
  linesDeleted: { color: colors.red, fontSize: fs.caption, fontWeight: '700', fontFamily: 'monospace' },
  diffContainer: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.sm, marginBottom: spacing.sm, marginLeft: 32, maxHeight: 300 },
  diffLine: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.xs },
  diffEmpty: { color: colors.textDim, fontSize: fs.caption, fontStyle: 'italic', padding: spacing.sm },
  commitArea: { backgroundColor: colors.elevated, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderStrong, padding: spacing.md, marginBottom: spacing.lg },
  commitInput: { color: colors.text, fontSize: fs.standard, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: 60, maxHeight: 120, marginBottom: spacing.md },
  commitActions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  commitBtn: { flex: 1, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center' },
  commitBtnText: { fontWeight: '700', fontSize: fs.body },
  amendToggle: { paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface },
  amendText: { color: colors.textMuted, fontSize: fs.caption, fontWeight: '700' },
  fab: { position: 'absolute', bottom: 20, right: 20, width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 6, zIndex: 10 },
  diffExpandBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, marginBottom: spacing.sm },
  diffExpandText: { fontSize: fs.caption, fontWeight: '600' },
  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 50, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, backgroundColor: colors.elevated },
  modalCloseBtn: { padding: spacing.sm, marginRight: spacing.md },
  modalTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modalTitle: { color: colors.text, fontSize: fs.body, fontWeight: '600', fontFamily: 'monospace', flex: 1 },
  modalStagedBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs },
  modalStagedText: { fontSize: fs.micro, fontWeight: '700' },
  modalLoading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalScroll: { flex: 1 },
  modalScrollContent: { padding: spacing.sm },
  modalDiffLine: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20, paddingHorizontal: spacing.xs },
  modalLineNum: { color: colors.textDim },
});
