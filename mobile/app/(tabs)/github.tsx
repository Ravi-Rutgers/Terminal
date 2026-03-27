import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Animated,
  PanResponder,
  Dimensions,
  Easing,
} from 'react-native';
import { showAlert } from '../../utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { getItem, setItem, deleteItem } from '../../utils/storage';
import { useRouter } from 'expo-router';
import { useStore } from '../../store';
import { useApi } from '../../hooks/useApi';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useGitHub, GITHUB_TOKEN_KEY, GITHUB_API } from '../../hooks/useGitHub';

// Language color map
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Dart: '#00B4AB',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Vue: '#41b883',
  Svelte: '#ff3e00',
};

interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  html_url: string;
  private: boolean;
  clone_url: string;
  owner: { login: string; avatar_url: string };
}

interface Issue {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  pull_request?: object;
  labels: { name: string; color: string }[];
}

interface PullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string };
  created_at: string;
  draft: boolean;
  labels: { name: string; color: string }[];
}

interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  head_branch: string;
  event: string;
}

interface RepoContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string } | null;
}

interface CommitDetail {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string };
  };
  author: { login: string } | null;
  stats: { additions: number; deletions: number; total: number };
  files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
}

interface IssueDetail {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  user: { login: string };
  created_at: string;
  labels: { name: string; color: string }[];
}

interface IssueComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

interface Branch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

interface PRDetail {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string;
  user: { login: string };
  created_at: string;
  head: { ref: string; label: string };
  base: { ref: string; label: string };
  labels: { name: string; color: string }[];
  additions: number;
  deletions: number;
  changed_files: number;
  commits: number;
}

interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  author: { login: string };
  assets: { name: string; download_count: number; size: number }[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'net';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}u`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}ma`;
}

type DetailTab = 'files' | 'commits' | 'branches' | 'issues' | 'prs' | 'actions' | 'releases';

const TAB_LABELS: Record<DetailTab, string> = {
  files: 'Bestanden',
  commits: 'Commits',
  branches: 'Branches',
  issues: 'Issues',
  prs: 'PRs',
  actions: 'Actions',
  releases: 'Releases',
};

const TAB_ORDER: DetailTab[] = ['files', 'commits', 'branches', 'issues', 'prs', 'actions', 'releases'];

const SCREEN_HEIGHT = Dimensions.get('window').height;
const MODAL_MIN_HEIGHT = 200;
const MODAL_DEFAULT_HEIGHT = SCREEN_HEIGHT * 0.5;
const MODAL_MAX_HEIGHT = SCREEN_HEIGHT * 0.92;
const MODAL_SNAP_POINTS = [MODAL_MIN_HEIGHT, MODAL_DEFAULT_HEIGHT, SCREEN_HEIGHT * 0.7, MODAL_MAX_HEIGHT];

function snapTo(value: number): number {
  let closest = MODAL_SNAP_POINTS[0];
  let minDist = Math.abs(value - closest);
  for (const point of MODAL_SNAP_POINTS) {
    const dist = Math.abs(value - point);
    if (dist < minDist) {
      minDist = dist;
      closest = point;
    }
  }
  return closest;
}

export default function GitHubScreen() {
  const { serverUrl, githubToken, setGithubToken, accentColor, addSession, setActiveSessionId, editorProjectPath } = useStore();
  const { apiFetch } = useApi();
  const { ghFetch, ghFetchRaw, ghFetchPages, ghPost, ghPatch, ghPut, ghDelete } = useGitHub();
  const { sendInput } = useWebSocket();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('files');
  const [loggingIn, setLoggingIn] = useState(false);
  const [filePath, setFilePath] = useState<string[]>([]);
  const [viewingFile, setViewingFile] = useState<{ name: string; path: string } | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [viewingCommit, setViewingCommit] = useState<string | null>(null);
  const [viewingDiff, setViewingDiff] = useState<{ filename: string; patch: string } | null>(null);
  const [viewingIssue, setViewingIssue] = useState<number | null>(null);
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [showNewIssue, setShowNewIssue] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueBody, setNewIssueBody] = useState('');
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchBase, setNewBranchBase] = useState('');
  const [viewingPR, setViewingPR] = useState<number | null>(null);
  const [prFilter, setPrFilter] = useState<'open' | 'closed'>('open');
  const [prCommentText, setPrCommentText] = useState('');
  const [viewingPRDiff, setViewingPRDiff] = useState<{ filename: string; patch: string } | null>(null);
  const [showNewPR, setShowNewPR] = useState(false);
  const [newPRTitle, setNewPRTitle] = useState('');
  const [newPRBody, setNewPRBody] = useState('');
  const [newPRHead, setNewPRHead] = useState('');
  const [newPRBase, setNewPRBase] = useState('');
  const [mergeMethod, setMergeMethod] = useState<'merge' | 'squash' | 'rebase'>('merge');
  const [gitActionLoading, setGitActionLoading] = useState<'clone' | 'pull' | 'push' | null>(null);
  const gitActionAnim = useRef(new Animated.Value(0)).current;

  // Panel slide — fixed height, animate translateY to extend/collapse
  // translateY = 0 means fully open (MODAL_MAX_HEIGHT visible)
  // translateY = MODAL_MAX_HEIGHT - MODAL_DEFAULT_HEIGHT means default position
  const defaultTranslateY = MODAL_MAX_HEIGHT - MODAL_DEFAULT_HEIGHT;
  const [panelTranslateY] = useState(() => new Animated.Value(defaultTranslateY));
  const panelCurrentTranslateY = useRef(defaultTranslateY);

  const panelPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        // dy positive = drag down = increase translateY (collapse)
        const newY = Math.max(0, Math.min(MODAL_MAX_HEIGHT, panelCurrentTranslateY.current + gesture.dy));
        panelTranslateY.setValue(newY);
      },
      onPanResponderRelease: (_, gesture) => {
        const rawY = panelCurrentTranslateY.current + gesture.dy;
        // If dragged down far enough, dismiss
        if (rawY > MODAL_MAX_HEIGHT - MODAL_MIN_HEIGHT * 0.6) {
          setSelectedRepo(null);
          panelCurrentTranslateY.current = defaultTranslateY;
          panelTranslateY.setValue(defaultTranslateY);
          return;
        }
        // Snap: convert translateY to visible height, snap, convert back
        const visibleHeight = MODAL_MAX_HEIGHT - rawY;
        const snappedHeight = snapTo(visibleHeight);
        const snappedY = MODAL_MAX_HEIGHT - snappedHeight;
        panelCurrentTranslateY.current = snappedY;
        Animated.spring(panelTranslateY, {
          toValue: snappedY,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
      },
    }),
  ).current;

  // Reset panel position when opening
  React.useEffect(() => {
    if (selectedRepo) {
      panelCurrentTranslateY.current = defaultTranslateY;
      panelTranslateY.setValue(defaultTranslateY);
    }
  }, [selectedRepo]);

  // Load stored GitHub token on mount
  React.useEffect(() => {
    getItem(GITHUB_TOKEN_KEY).then((stored) => {
      if (stored && !githubToken) setGithubToken(stored);
    });
  }, []);

  // Fetch all repos with pagination
  const ghFetchAllRepos = useCallback(async (): Promise<Repo[]> => {
    return ghFetchPages<Repo>('/user/repos?sort=pushed&direction=desc&visibility=all&affiliation=owner,collaborator,organization_member');
  }, [ghFetchPages]);

  // Fetch repos
  const {
    data: repos = [],
    isLoading: loadingRepos,
    refetch: refetchRepos,
  } = useQuery<Repo[]>({
    queryKey: ['github-repos', githubToken],
    queryFn: ghFetchAllRepos,
    enabled: !!githubToken,
    staleTime: 60000,
  });

  // Fetch issues for selected repo
  const { data: issues = [], isLoading: loadingIssues, refetch: refetchIssues } = useQuery<Issue[]>({
    queryKey: ['github-issues', selectedRepo?.full_name, issueFilter],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/issues?state=${issueFilter}&per_page=30`),
    enabled: !!selectedRepo && detailTab === 'issues',
  });

  // Fetch issue detail
  const { data: issueDetail, isLoading: loadingIssueDetail } = useQuery<IssueDetail>({
    queryKey: ['github-issue-detail', selectedRepo?.full_name, viewingIssue],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/issues/${viewingIssue}`),
    enabled: !!selectedRepo && !!viewingIssue,
  });

  // Fetch issue comments
  const { data: issueComments = [], isLoading: loadingComments, refetch: refetchComments } = useQuery<IssueComment[]>({
    queryKey: ['github-issue-comments', selectedRepo?.full_name, viewingIssue],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/issues/${viewingIssue}/comments`),
    enabled: !!selectedRepo && !!viewingIssue,
  });

  // Fetch PRs for selected repo
  const { data: pulls = [], isLoading: loadingPRs, refetch: refetchPRs } = useQuery<PullRequest[]>({
    queryKey: ['github-prs', selectedRepo?.full_name, prFilter],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/pulls?state=${prFilter}&per_page=30`),
    enabled: !!selectedRepo && detailTab === 'prs',
  });

  // Fetch PR detail
  const { data: prDetail, isLoading: loadingPRDetail } = useQuery<PRDetail>({
    queryKey: ['github-pr-detail', selectedRepo?.full_name, viewingPR],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/pulls/${viewingPR}`),
    enabled: !!selectedRepo && !!viewingPR,
  });

  // Fetch PR files
  const { data: prFiles = [], isLoading: loadingPRFiles } = useQuery<PRFile[]>({
    queryKey: ['github-pr-files', selectedRepo?.full_name, viewingPR],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/pulls/${viewingPR}/files?per_page=100`),
    enabled: !!selectedRepo && !!viewingPR,
  });

  // Fetch PR comments (uses issues endpoint)
  const { data: prComments = [], isLoading: loadingPRComments, refetch: refetchPRComments } = useQuery<IssueComment[]>({
    queryKey: ['github-pr-comments', selectedRepo?.full_name, viewingPR],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/issues/${viewingPR}/comments?per_page=50`),
    enabled: !!selectedRepo && !!viewingPR,
  });

  // Fetch actions for selected repo
  const { data: actionsData, isLoading: loadingActions } = useQuery<{ workflow_runs: WorkflowRun[] }>({
    queryKey: ['github-actions', selectedRepo?.full_name],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/actions/runs?per_page=15`),
    enabled: !!selectedRepo && detailTab === 'actions',
  });
  const actions = actionsData?.workflow_runs || [];

  // Filter issues to exclude PRs (GitHub includes PRs in issues endpoint)
  const pureIssues = issues.filter((i) => !i.pull_request);

  // Fetch directory contents for file browser
  const currentPath = filePath.join('/');
  const branchRef = selectedBranch ? `?ref=${encodeURIComponent(selectedBranch)}` : '';
  const { data: dirContents = [], isLoading: loadingDir } = useQuery<RepoContent[]>({
    queryKey: ['github-contents', selectedRepo?.full_name, currentPath, selectedBranch],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/contents/${currentPath}${branchRef}`),
    enabled: !!selectedRepo && detailTab === 'files' && !viewingFile,
    staleTime: 30000,
  });

  // Sort: directories first, then files, alphabetically
  const sortedContents = [...dirContents].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });

  // Fetch file content
  const { data: fileContent, isLoading: loadingFile } = useQuery<string>({
    queryKey: ['github-file', selectedRepo?.full_name, viewingFile?.path, selectedBranch],
    queryFn: () => ghFetchRaw(`/repos/${selectedRepo!.full_name}/contents/${viewingFile!.path}${branchRef}`),
    enabled: !!selectedRepo && !!viewingFile,
    staleTime: 30000,
  });

  // Fetch commits
  const { data: commits = [], isLoading: loadingCommits } = useQuery<Commit[]>({
    queryKey: ['github-commits', selectedRepo?.full_name],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/commits?per_page=30`),
    enabled: !!selectedRepo && detailTab === 'commits',
    staleTime: 30000,
  });

  // Fetch single commit detail
  const { data: commitDetail, isLoading: loadingCommitDetail } = useQuery<CommitDetail>({
    queryKey: ['github-commit-detail', selectedRepo?.full_name, viewingCommit],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/commits/${viewingCommit}`),
    enabled: !!selectedRepo && !!viewingCommit,
    staleTime: 60000,
  });

  // Fetch branches
  const { data: branches = [], isLoading: loadingBranches, refetch: refetchBranches } = useQuery<Branch[]>({
    queryKey: ['github-branches', selectedRepo?.full_name],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/branches?per_page=100`),
    enabled: !!selectedRepo && (detailTab === 'branches' || detailTab === 'prs'),
    staleTime: 30000,
  });

  // Fetch releases
  const { data: releases = [], isLoading: loadingReleases } = useQuery<Release[]>({
    queryKey: ['github-releases', selectedRepo?.full_name],
    queryFn: () => ghFetch(`/repos/${selectedRepo!.full_name}/releases?per_page=20`),
    enabled: !!selectedRepo && detailTab === 'releases',
    staleTime: 60000,
  });

  // Reset state when repo changes
  React.useEffect(() => {
    setFilePath([]);
    setViewingFile(null);
    setSelectedBranch(null);
    setViewingCommit(null);
    setViewingDiff(null);
    setShowNewBranch(false);
    setNewBranchName('');
    setNewBranchBase('');
    setViewingIssue(null);
    setIssueFilter('open');
    setShowNewIssue(false);
    setNewIssueTitle('');
    setNewIssueBody('');
    setCommentText('');
    setViewingPR(null);
    setPrFilter('open');
    setPrCommentText('');
    setViewingPRDiff(null);
    setShowNewPR(false);
    setNewPRTitle('');
    setNewPRBody('');
    setNewPRHead('');
    setNewPRBase('');
    setMergeMethod('merge');
  }, [selectedRepo?.id]);

  const [tokenInput, setTokenInput] = useState('');

  // PAT login
  const loginWithPAT = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    setLoggingIn(true);
    try {
      const res = await fetch(`${GITHUB_API}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (!res.ok) {
        showAlert('Fout', 'Ongeldig token. Controleer je Personal Access Token.');
        return;
      }
      setGithubToken(token);
      await setItem(GITHUB_TOKEN_KEY, token);
      setTokenInput('');
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    setGithubToken(null);
    await deleteItem(GITHUB_TOKEN_KEY);
  };

  const playGitAnimation = () => {
    gitActionAnim.setValue(0);
    Animated.sequence([
      Animated.timing(gitActionAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
      Animated.timing(gitActionAnim, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start();
  };

  const runInTerminal = async (command: string, action?: 'clone' | 'pull' | 'push') => {
    if (gitActionLoading) return;
    setGitActionLoading(action || null);
    playGitAnimation();
    try {
      const session = await apiFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      addSession(session);
      setActiveSessionId(session.id);
      // Small delay to let WebSocket connect before sending input
      setTimeout(() => {
        sendInput(session.id, command + '\r');
      }, 500);
      setSelectedRepo(null);
      router.push('/(tabs)/terminal');
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setGitActionLoading(null);
    }
  };

  const cloneToTerminal = (repo: Repo) => runInTerminal(`git clone "${repo.clone_url}"`, 'clone');

  const createBranch = async () => {
    if (!selectedRepo || !newBranchName.trim() || !newBranchBase) return;
    try {
      const baseBranch = branches.find((b) => b.name === newBranchBase);
      if (!baseBranch) return;
      await ghPost(`/repos/${selectedRepo.full_name}/git/refs`, {
        ref: `refs/heads/${newBranchName.trim()}`,
        sha: baseBranch.commit.sha,
      });
      setShowNewBranch(false);
      setNewBranchName('');
      setNewBranchBase('');
      refetchBranches();
    } catch (err: any) {
      showAlert('Fout', err.message);
    }
  };

  const deleteBranch = async (branchName: string) => {
    if (!selectedRepo) return;
    try {
      await ghDelete(`/repos/${selectedRepo.full_name}/git/refs/heads/${branchName}`);
      refetchBranches();
    } catch (err: any) {
      showAlert('Fout', err.message);
    }
  };

  const createIssue = async () => {
    if (!selectedRepo || !newIssueTitle.trim()) return;
    setSubmitting(true);
    try {
      await ghPost(`/repos/${selectedRepo.full_name}/issues`, {
        title: newIssueTitle.trim(),
        body: newIssueBody.trim() || undefined,
      });
      setShowNewIssue(false);
      setNewIssueTitle('');
      setNewIssueBody('');
      refetchIssues();
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleIssueState = async () => {
    if (!selectedRepo || !issueDetail) return;
    setSubmitting(true);
    try {
      const newState = issueDetail.state === 'open' ? 'closed' : 'open';
      await ghPatch(`/repos/${selectedRepo.full_name}/issues/${issueDetail.number}`, { state: newState });
      refetchIssues();
      setViewingIssue(null);
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const postComment = async () => {
    if (!selectedRepo || !viewingIssue || !commentText.trim()) return;
    setSubmitting(true);
    try {
      await ghPost(`/repos/${selectedRepo.full_name}/issues/${viewingIssue}/comments`, {
        body: commentText.trim(),
      });
      setCommentText('');
      refetchComments();
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const mergePR = async () => {
    if (!selectedRepo || !viewingPR) return;
    setSubmitting(true);
    try {
      await ghPut(`/repos/${selectedRepo.full_name}/pulls/${viewingPR}/merge`, { merge_method: mergeMethod });
      showAlert('Gelukt', 'Pull request is gemerged');
      refetchPRs();
      setViewingPR(null);
    } catch (err: any) {
      if (err.message?.includes('405') || err.message?.includes('409') || err.message?.toLowerCase().includes('conflict')) {
        showAlert('Merge conflict', 'Er zijn conflicten die eerst opgelost moeten worden voordat deze PR gemerged kan worden.');
      } else if (err.message?.includes('not mergeable')) {
        showAlert('Niet mergeable', 'Deze pull request kan momenteel niet gemerged worden. Controleer de checks en reviews.');
      } else {
        showAlert('Fout', err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const closePR = async () => {
    if (!selectedRepo || !viewingPR) return;
    setSubmitting(true);
    try {
      await ghPatch(`/repos/${selectedRepo.full_name}/pulls/${viewingPR}`, {
        state: prDetail?.state === 'open' ? 'closed' : 'open',
      });
      refetchPRs();
      setViewingPR(null);
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const postPRComment = async () => {
    if (!selectedRepo || !viewingPR || !prCommentText.trim()) return;
    setSubmitting(true);
    try {
      await ghPost(`/repos/${selectedRepo.full_name}/issues/${viewingPR}/comments`, {
        body: prCommentText.trim(),
      });
      setPrCommentText('');
      refetchPRComments();
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const createPR = async () => {
    if (!selectedRepo || !newPRTitle.trim() || !newPRHead || !newPRBase) return;
    setSubmitting(true);
    try {
      await ghPost(`/repos/${selectedRepo.full_name}/pulls`, {
        title: newPRTitle.trim(),
        body: newPRBody.trim() || undefined,
        head: newPRHead,
        base: newPRBase,
      });
      setShowNewPR(false);
      setNewPRTitle('');
      setNewPRBody('');
      setNewPRHead('');
      setNewPRBase('');
      refetchPRs();
    } catch (err: any) {
      showAlert('Fout', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Filtered repos
  const filteredRepos = search
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          (r.description || '').toLowerCase().includes(search.toLowerCase()),
      )
    : repos;

  // --- Not logged in ---
  if (!githubToken) {
    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.loginScrollContent}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.loginContainer}>
            <View style={[styles.loginIcon, { backgroundColor: accentColor + '20' }]}>
              <Ionicons name="logo-github" size={48} color={accentColor} />
            </View>
            <Text style={styles.loginTitle}>GitHub Verbinden</Text>
            <Text style={styles.loginSubtitle}>
              Voer een Personal Access Token in om je repositories, issues, pull requests en actions te bekijken.
            </Text>
            <Text style={styles.loginHint}>
              Maak een Fine-grained token aan via GitHub {'\u2192'} Settings {'\u2192'} Developer settings {'\u2192'} Personal access tokens. Kies 'All repositories' en permissions: Contents, Issues, Pull requests, Actions, Administration.
            </Text>
            <TextInput
              style={styles.tokenInput}
              placeholder="ghp_xxxxxxxxxxxx"
              placeholderTextColor="#555"
              value={tokenInput}
              onChangeText={setTokenInput}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.loginButton, { backgroundColor: accentColor, opacity: tokenInput.trim() ? 1 : 0.5 }]}
              onPress={loginWithPAT}
              disabled={loggingIn || !tokenInput.trim()}
            >
              {loggingIn ? (
                <ActivityIndicator color="#0a0a0a" />
              ) : (
                <>
                  <Ionicons name="logo-github" size={20} color="#0a0a0a" style={{ marginRight: 8 }} />
                  <Text style={styles.loginButtonText}>Verbinden</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // --- Repo list ---
  const renderRepo = ({ item }: { item: Repo }) => (
    <TouchableOpacity
      style={styles.repoCard}
      onPress={() => {
        setSelectedRepo(item);
        setDetailTab('files');
      }}
      activeOpacity={0.7}
    >
      <View style={styles.repoHeader}>
        <View style={styles.repoNameRow}>
          <Ionicons
            name={item.private ? 'lock-closed' : 'git-branch'}
            size={14}
            color={item.private ? '#f59e0b' : '#888'}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.repoName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        {item.language && (
          <View style={styles.langBadge}>
            <View style={[styles.langDot, { backgroundColor: LANG_COLORS[item.language] || '#888' }]} />
            <Text style={styles.langText}>{item.language}</Text>
          </View>
        )}
      </View>
      {item.description && (
        <Text style={styles.repoDesc} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <View style={styles.repoMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="star-outline" size={13} color="#888" />
          <Text style={styles.metaText}>{item.stargazers_count}</Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="git-network-outline" size={13} color="#888" />
          <Text style={styles.metaText}>{item.forks_count}</Text>
        </View>
        {item.open_issues_count > 0 && (
          <View style={styles.metaItem}>
            <Ionicons name="alert-circle-outline" size={13} color="#888" />
            <Text style={styles.metaText}>{item.open_issues_count}</Text>
          </View>
        )}
        <Text style={styles.metaTime}>{timeAgo(item.pushed_at)}</Text>
      </View>
    </TouchableOpacity>
  );

  // --- File icon helper ---
  const getFileIcon = (item: RepoContent): { name: string; color: string } => {
    if (item.type === 'dir') return { name: 'folder', color: '#f59e0b' };
    if (item.type === 'submodule') return { name: 'git-branch', color: '#a78bfa' };
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    if (['ts', 'tsx'].includes(ext)) return { name: 'logo-javascript', color: '#3178c6' };
    if (['js', 'jsx'].includes(ext)) return { name: 'logo-javascript', color: '#f1e05a' };
    if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return { name: 'settings-outline', color: '#888' };
    if (['md', 'txt', 'rst'].includes(ext)) return { name: 'document-text-outline', color: '#888' };
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico'].includes(ext)) return { name: 'image-outline', color: '#a78bfa' };
    return { name: 'document-outline', color: '#888' };
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // --- Action run status icon ---
  const getRunIcon = (run: WorkflowRun): { name: string; color: string } => {
    if (run.status === 'in_progress' || run.status === 'queued') return { name: 'sync', color: '#f59e0b' };
    if (run.conclusion === 'success') return { name: 'checkmark-circle', color: '#4ade80' };
    if (run.conclusion === 'failure') return { name: 'close-circle', color: '#ef4444' };
    if (run.conclusion === 'cancelled') return { name: 'stop-circle', color: '#888' };
    return { name: 'ellipse', color: '#888' };
  };

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={16} color="#666" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Zoeken..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={16} color="#666" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={logout} style={{ marginLeft: 12 }}>
          <Ionicons name="log-out-outline" size={18} color="#888" />
        </TouchableOpacity>
      </View>

      {/* Repo count */}
      <Text style={styles.repoCount}>
        {filteredRepos.length} {filteredRepos.length === 1 ? 'repository' : 'repositories'}
      </Text>

      {/* Repo list */}
      <FlatList
        data={filteredRepos}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderRepo}
        refreshControl={
          <RefreshControl
            refreshing={loadingRepos}
            onRefresh={refetchRepos}
            tintColor={accentColor}
            colors={[accentColor]}
          />
        }
        contentContainerStyle={{ paddingBottom: 20 }}
        ListEmptyComponent={
          !loadingRepos ? (
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={40} color="#444" />
              <Text style={styles.emptyText}>
                {search ? 'Geen repositories gevonden' : 'Geen repositories'}
              </Text>
            </View>
          ) : null
        }
      />

      {/* Repo detail panel */}
      {!!selectedRepo && (
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedRepo(null)}
        />
      )}
      {!!selectedRepo && (
        <Animated.View style={[styles.modalContent, { height: MODAL_MAX_HEIGHT, transform: [{ translateY: panelTranslateY }] }]}>
                {/* Drag handle */}
                <View {...panelPanResponder.panHandlers} style={styles.dragArea}>
                  <View style={styles.dragHandle} />
                </View>
                {/* Modal header */}
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      {selectedRepo.name}
                    </Text>
                    <Text style={styles.modalOwner}>{selectedRepo.owner.login}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedRepo(null)}>
                    <Ionicons name="close" size={24} color="#888" />
                  </TouchableOpacity>
                </View>

                {selectedRepo.description && (
                  <Text style={styles.modalDesc}>{selectedRepo.description}</Text>
                )}

                {/* Tab selector */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={styles.tabRowContent}>
                  {TAB_ORDER.map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      style={[styles.tab, detailTab === tab && { borderBottomColor: accentColor }]}
                      onPress={() => setDetailTab(tab)}
                    >
                      <Text
                        style={[styles.tabText, detailTab === tab && { color: accentColor }]}
                      >
                        {TAB_LABELS[tab]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Tab content */}
                <ScrollView style={styles.tabContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {detailTab === 'files' && (
                    viewingFile ? (
                      // File viewer
                      <View>
                        <TouchableOpacity
                          style={styles.breadcrumbRow}
                          onPress={() => setViewingFile(null)}
                        >
                          <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.breadcrumbText, { color: accentColor }]} numberOfLines={1}>
                            {viewingFile.path}
                          </Text>
                        </TouchableOpacity>
                        {loadingFile ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : (
                          <ScrollView horizontal style={styles.fileViewerContainer}>
                            <Text style={styles.fileViewerText} selectable>
                              {fileContent || ''}
                            </Text>
                          </ScrollView>
                        )}
                      </View>
                    ) : (
                      // Directory browser
                      <View>
                        {/* Branch + Breadcrumb */}
                        {selectedBranch && (
                          <View style={styles.branchIndicator}>
                            <Ionicons name="git-branch-outline" size={13} color={accentColor} style={{ marginRight: 4 }} />
                            <Text style={[styles.breadcrumbText, { color: accentColor }]}>{selectedBranch}</Text>
                            <TouchableOpacity onPress={() => setSelectedBranch(null)} style={{ marginLeft: 8 }}>
                              <Ionicons name="close-circle" size={14} color="#555" />
                            </TouchableOpacity>
                          </View>
                        )}
                        <View style={styles.breadcrumbRow}>
                          <TouchableOpacity onPress={() => setFilePath([])}>
                            <Ionicons name="home-outline" size={14} color={filePath.length > 0 ? accentColor : '#888'} />
                          </TouchableOpacity>
                          {filePath.map((segment, i) => (
                            <React.Fragment key={i}>
                              <Text style={styles.breadcrumbSep}>/</Text>
                              <TouchableOpacity onPress={() => setFilePath(filePath.slice(0, i + 1))}>
                                <Text style={[styles.breadcrumbText, i === filePath.length - 1 ? { color: '#e0e0e0' } : { color: accentColor }]}>
                                  {segment}
                                </Text>
                              </TouchableOpacity>
                            </React.Fragment>
                          ))}
                        </View>
                        {loadingDir ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : sortedContents.length === 0 ? (
                          <Text style={styles.emptyTabText}>Geen bestanden</Text>
                        ) : (
                          sortedContents.map((item) => {
                            const icon = getFileIcon(item);
                            return (
                              <TouchableOpacity
                                key={item.sha}
                                style={styles.listItem}
                                onPress={() => {
                                  if (item.type === 'dir') {
                                    setFilePath([...filePath, item.name]);
                                  } else if (item.type === 'file') {
                                    setViewingFile({ name: item.name, path: item.path });
                                  }
                                }}
                                activeOpacity={0.7}
                              >
                                <Ionicons
                                  name={icon.name as any}
                                  size={16}
                                  color={icon.color}
                                  style={{ marginRight: 8, marginTop: 2 }}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.listItemTitle} numberOfLines={1}>
                                    {item.name}
                                  </Text>
                                  {item.type === 'file' && (
                                    <Text style={styles.listItemMeta}>{formatFileSize(item.size)}</Text>
                                  )}
                                </View>
                                {item.type === 'dir' && (
                                  <Ionicons name="chevron-forward" size={14} color="#555" />
                                )}
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>
                    )
                  )}

                  {detailTab === 'commits' && (
                    viewingDiff ? (
                      // Diff view for a single file
                      <View>
                        <TouchableOpacity
                          style={styles.breadcrumbRow}
                          onPress={() => setViewingDiff(null)}
                        >
                          <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.breadcrumbText, { color: accentColor }]}>Terug</Text>
                        </TouchableOpacity>
                        <Text style={[styles.listItemTitle, { paddingVertical: 8 }]}>{viewingDiff.filename}</Text>
                        <ScrollView horizontal nestedScrollEnabled>
                          <View>
                            {viewingDiff.patch.split('\n').map((line, idx) => {
                              const isAdd = line.startsWith('+');
                              const isDel = line.startsWith('-');
                              const isHunk = line.startsWith('@@');
                              return (
                                <View
                                  key={idx}
                                  style={[
                                    styles.diffLine,
                                    isAdd && styles.diffLineAdd,
                                    isDel && styles.diffLineDel,
                                    isHunk && styles.diffLineHunk,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.diffLineText,
                                      isAdd && { color: '#4ade80' },
                                      isDel && { color: '#ef4444' },
                                      isHunk && { color: '#a78bfa' },
                                    ]}
                                    selectable
                                  >
                                    {line}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        </ScrollView>
                      </View>
                    ) : viewingCommit ? (
                      // Commit detail with file list
                      <View>
                        <TouchableOpacity
                          style={styles.breadcrumbRow}
                          onPress={() => setViewingCommit(null)}
                        >
                          <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.breadcrumbText, { color: accentColor }]}>Terug naar commits</Text>
                        </TouchableOpacity>
                        {loadingCommitDetail ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : commitDetail ? (
                          <View>
                            <Text style={styles.commitDetailMessage}>{commitDetail.commit.message}</Text>
                            <View style={styles.commitDetailStats}>
                              <Text style={[styles.commitStatAdd, { color: '#4ade80' }]}>+{commitDetail.stats.additions}</Text>
                              <Text style={[styles.commitStatDel, { color: '#ef4444' }]}> -{commitDetail.stats.deletions}</Text>
                              <Text style={styles.listItemMeta}> · {commitDetail.files?.length || 0} bestanden</Text>
                            </View>
                            {commitDetail.files?.map((file) => (
                              <TouchableOpacity
                                key={file.filename}
                                style={styles.listItem}
                                activeOpacity={0.7}
                                onPress={() => {
                                  if (file.patch) {
                                    setViewingDiff({ filename: file.filename, patch: file.patch });
                                  }
                                }}
                              >
                                <Ionicons
                                  name={file.status === 'added' ? 'add-circle-outline' : file.status === 'removed' ? 'remove-circle-outline' : 'create-outline'}
                                  size={14}
                                  color={file.status === 'added' ? '#4ade80' : file.status === 'removed' ? '#ef4444' : '#f59e0b'}
                                  style={{ marginRight: 8, marginTop: 3 }}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.listItemTitle} numberOfLines={1}>{file.filename}</Text>
                                  <Text style={styles.listItemMeta}>
                                    <Text style={{ color: '#4ade80' }}>+{file.additions}</Text>
                                    {' '}
                                    <Text style={{ color: '#ef4444' }}>-{file.deletions}</Text>
                                  </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={14} color="#555" />
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ) : (
                      // Commit list
                      loadingCommits ? (
                        <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                      ) : commits.length === 0 ? (
                        <Text style={styles.emptyTabText}>Geen commits</Text>
                      ) : (
                        commits.map((c) => (
                          <TouchableOpacity
                            key={c.sha}
                            style={styles.listItem}
                            onPress={() => setViewingCommit(c.sha)}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="git-commit-outline" size={16} color="#888" style={{ marginRight: 8, marginTop: 2 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.listItemTitle} numberOfLines={2}>
                                {c.commit.message.split('\n')[0]}
                              </Text>
                              <Text style={styles.listItemMeta}>
                                {c.sha.slice(0, 7)} · {c.author?.login || c.commit.author.name} · {timeAgo(c.commit.author.date)}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={14} color="#555" />
                          </TouchableOpacity>
                        ))
                      )
                    )
                  )}

                  {detailTab === 'issues' && (
                    viewingIssue ? (
                      // Issue detail
                      <View>
                        <TouchableOpacity
                          style={styles.breadcrumbRow}
                          onPress={() => { setViewingIssue(null); setCommentText(''); }}
                        >
                          <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                          <Text style={[styles.breadcrumbText, { color: accentColor }]}>Terug naar issues</Text>
                        </TouchableOpacity>
                        {loadingIssueDetail ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : issueDetail ? (
                          <View>
                            <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <View style={[styles.issueStateBadge, { backgroundColor: issueDetail.state === 'open' ? '#4ade8020' : '#a78bfa20' }]}>
                                  <Ionicons
                                    name={issueDetail.state === 'open' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                                    size={12}
                                    color={issueDetail.state === 'open' ? '#4ade80' : '#a78bfa'}
                                    style={{ marginRight: 4 }}
                                  />
                                  <Text style={{ color: issueDetail.state === 'open' ? '#4ade80' : '#a78bfa', fontSize: 11, fontWeight: '600' }}>
                                    {issueDetail.state === 'open' ? 'Open' : 'Gesloten'}
                                  </Text>
                                </View>
                              </View>
                              <Text style={styles.commitDetailMessage}>#{issueDetail.number} {issueDetail.title}</Text>
                              <Text style={styles.listItemMeta}>{issueDetail.user.login} · {timeAgo(issueDetail.created_at)}</Text>
                              {issueDetail.body && (
                                <Text style={styles.issueBody}>{issueDetail.body}</Text>
                              )}
                              {issueDetail.labels.length > 0 && (
                                <View style={[styles.labelRow, { marginTop: 8 }]}>
                                  {issueDetail.labels.map((l) => (
                                    <View key={l.name} style={[styles.label, { backgroundColor: `#${l.color}30`, borderColor: `#${l.color}60` }]}>
                                      <Text style={[styles.labelText, { color: `#${l.color}` }]}>{l.name}</Text>
                                    </View>
                                  ))}
                                </View>
                              )}
                            </View>

                            {/* Comments */}
                            <Text style={styles.commentSectionTitle}>
                              Reacties ({loadingComments ? '...' : issueComments.length})
                            </Text>
                            {loadingComments ? (
                              <ActivityIndicator color={accentColor} style={{ marginTop: 10 }} />
                            ) : issueComments.length === 0 ? (
                              <Text style={[styles.emptyTabText, { paddingTop: 8 }]}>Geen reacties</Text>
                            ) : (
                              issueComments.map((c) => (
                                <View key={c.id} style={styles.commentItem}>
                                  <Text style={styles.commentAuthor}>{c.user.login} <Text style={styles.listItemMeta}>· {timeAgo(c.created_at)}</Text></Text>
                                  <Text style={styles.commentBody}>{c.body}</Text>
                                </View>
                              ))
                            )}

                            {/* Comment input */}
                            <View style={styles.commentInputRow}>
                              <TextInput
                                style={styles.commentInput}
                                placeholder="Schrijf een reactie..."
                                placeholderTextColor="#555"
                                value={commentText}
                                onChangeText={setCommentText}
                                multiline
                              />
                              <TouchableOpacity
                                style={[styles.commentSendBtn, { backgroundColor: accentColor, opacity: commentText.trim() ? 1 : 0.5 }]}
                                onPress={postComment}
                                disabled={submitting || !commentText.trim()}
                              >
                                {submitting ? (
                                  <ActivityIndicator color="#0a0a0a" size="small" />
                                ) : (
                                  <Ionicons name="send" size={16} color="#0a0a0a" />
                                )}
                              </TouchableOpacity>
                            </View>

                            {/* Close/reopen button */}
                            <TouchableOpacity
                              style={[styles.issueActionBtn, { borderColor: issueDetail.state === 'open' ? '#ef4444' : '#4ade80' }]}
                              onPress={toggleIssueState}
                              disabled={submitting}
                            >
                              <Ionicons
                                name={issueDetail.state === 'open' ? 'close-circle-outline' : 'checkmark-circle-outline'}
                                size={16}
                                color={issueDetail.state === 'open' ? '#ef4444' : '#4ade80'}
                                style={{ marginRight: 6 }}
                              />
                              <Text style={{ color: issueDetail.state === 'open' ? '#ef4444' : '#4ade80', fontWeight: '600', fontSize: 14 }}>
                                {issueDetail.state === 'open' ? 'Issue sluiten' : 'Issue heropenen'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                    ) : showNewIssue ? (
                      // New issue form
                      <View style={styles.newBranchForm}>
                        <TextInput
                          style={styles.newBranchInput}
                          placeholder="Titel *"
                          placeholderTextColor="#555"
                          value={newIssueTitle}
                          onChangeText={setNewIssueTitle}
                        />
                        <TextInput
                          style={[styles.newBranchInput, { minHeight: 80, textAlignVertical: 'top' }]}
                          placeholder="Beschrijving (optioneel)"
                          placeholderTextColor="#555"
                          value={newIssueBody}
                          onChangeText={setNewIssueBody}
                          multiline
                        />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: accentColor, opacity: newIssueTitle.trim() ? 1 : 0.5, flex: 1 }]}
                            onPress={createIssue}
                            disabled={submitting || !newIssueTitle.trim()}
                          >
                            {submitting ? (
                              <ActivityIndicator color="#0a0a0a" size="small" />
                            ) : (
                              <Text style={styles.newBranchBtnText}>Aanmaken</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: '#222', flex: 1 }]}
                            onPress={() => { setShowNewIssue(false); setNewIssueTitle(''); setNewIssueBody(''); }}
                          >
                            <Text style={[styles.newBranchBtnText, { color: '#888' }]}>Annuleren</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      // Issue list
                      <View>
                        {/* Filter + new button */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 }}>
                          <TouchableOpacity
                            style={[styles.branchChip, issueFilter === 'open' && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                            onPress={() => setIssueFilter('open')}
                          >
                            <Text style={[styles.branchChipText, issueFilter === 'open' && { color: accentColor }]}>Open</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.branchChip, issueFilter === 'closed' && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                            onPress={() => setIssueFilter('closed')}
                          >
                            <Text style={[styles.branchChipText, issueFilter === 'closed' && { color: accentColor }]}>Gesloten</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: accentColor, marginLeft: 'auto', paddingHorizontal: 12 }]}
                            onPress={() => setShowNewIssue(true)}
                          >
                            <Ionicons name="add" size={14} color="#0a0a0a" style={{ marginRight: 2 }} />
                            <Text style={styles.newBranchBtnText}>Nieuw</Text>
                          </TouchableOpacity>
                        </View>
                        {loadingIssues ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : pureIssues.length === 0 ? (
                          <Text style={styles.emptyTabText}>Geen {issueFilter === 'open' ? 'open' : 'gesloten'} issues</Text>
                        ) : (
                          pureIssues.map((issue) => (
                            <TouchableOpacity
                              key={issue.id}
                              style={styles.listItem}
                              activeOpacity={0.7}
                              onPress={() => setViewingIssue(issue.number)}
                            >
                              <Ionicons
                                name={issue.state === 'open' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
                                size={16}
                                color={issue.state === 'open' ? '#4ade80' : '#a78bfa'}
                                style={{ marginRight: 8, marginTop: 2 }}
                              />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.listItemTitle} numberOfLines={2}>
                                  #{issue.number} {issue.title}
                                </Text>
                                <Text style={styles.listItemMeta}>
                                  {issue.user.login} · {timeAgo(issue.created_at)}
                                </Text>
                                {issue.labels.length > 0 && (
                                  <View style={styles.labelRow}>
                                    {issue.labels.slice(0, 3).map((l) => (
                                      <View
                                        key={l.name}
                                        style={[styles.label, { backgroundColor: `#${l.color}30`, borderColor: `#${l.color}60` }]}
                                      >
                                        <Text style={[styles.labelText, { color: `#${l.color}` }]}>{l.name}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                              <Ionicons name="chevron-forward" size={14} color="#555" />
                            </TouchableOpacity>
                          ))
                        )}
                      </View>
                    )
                  )}

                  {detailTab === 'prs' && (
                    viewingPR ? (
                      viewingPRDiff ? (
                        // PR diff view
                        <View>
                          <TouchableOpacity
                            style={styles.breadcrumbRow}
                            onPress={() => setViewingPRDiff(null)}
                          >
                            <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                            <Text style={[styles.breadcrumbText, { color: accentColor }]}>Terug naar PR</Text>
                          </TouchableOpacity>
                          <Text style={styles.commitDetailMessage} numberOfLines={2}>{viewingPRDiff.filename}</Text>
                          <ScrollView horizontal nestedScrollEnabled>
                            <View style={styles.diffContainer}>
                              {viewingPRDiff.patch.split('\n').map((line, i) => (
                                <Text
                                  key={i}
                                  style={[
                                    styles.diffLine,
                                    line.startsWith('+') && !line.startsWith('+++') && styles.diffLineAdd,
                                    line.startsWith('-') && !line.startsWith('---') && styles.diffLineDel,
                                    line.startsWith('@@') && styles.diffLineHunk,
                                  ]}
                                >
                                  {line}
                                </Text>
                              ))}
                            </View>
                          </ScrollView>
                        </View>
                      ) : (
                        // PR detail view
                        <View>
                          <TouchableOpacity
                            style={styles.breadcrumbRow}
                            onPress={() => { setViewingPR(null); setPrCommentText(''); }}
                          >
                            <Ionicons name="arrow-back" size={16} color={accentColor} style={{ marginRight: 6 }} />
                            <Text style={[styles.breadcrumbText, { color: accentColor }]}>Terug naar PRs</Text>
                          </TouchableOpacity>
                          {loadingPRDetail ? (
                            <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                          ) : prDetail ? (
                            <View>
                              {/* PR header */}
                              <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <View style={[styles.issueStateBadge, {
                                    backgroundColor: prDetail.merged ? '#a78bfa20' : prDetail.state === 'open' ? '#4ade8020' : '#ef444420',
                                  }]}>
                                    <Ionicons
                                      name={prDetail.merged ? 'git-merge' : 'git-pull-request'}
                                      size={12}
                                      color={prDetail.merged ? '#a78bfa' : prDetail.state === 'open' ? '#4ade80' : '#ef4444'}
                                      style={{ marginRight: 4 }}
                                    />
                                    <Text style={{
                                      color: prDetail.merged ? '#a78bfa' : prDetail.state === 'open' ? '#4ade80' : '#ef4444',
                                      fontSize: 11, fontWeight: '600',
                                    }}>
                                      {prDetail.merged ? 'Gemerged' : prDetail.state === 'open' ? (prDetail.draft ? 'Draft' : 'Open') : 'Gesloten'}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.commitDetailMessage}>#{prDetail.number} {prDetail.title}</Text>
                                <Text style={styles.listItemMeta}>
                                  {prDetail.user.login} · {timeAgo(prDetail.created_at)} · {prDetail.head.ref} → {prDetail.base.ref}
                                </Text>
                                {prDetail.body && (
                                  <Text style={styles.issueBody}>{prDetail.body}</Text>
                                )}
                                {prDetail.labels.length > 0 && (
                                  <View style={[styles.labelRow, { marginTop: 8 }]}>
                                    {prDetail.labels.map((l) => (
                                      <View key={l.name} style={[styles.label, { backgroundColor: `#${l.color}30`, borderColor: `#${l.color}60` }]}>
                                        <Text style={[styles.labelText, { color: `#${l.color}` }]}>{l.name}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                                {/* Stats */}
                                <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                                  <Text style={{ color: '#4ade80', fontSize: 12 }}>+{prDetail.additions}</Text>
                                  <Text style={{ color: '#ef4444', fontSize: 12 }}>-{prDetail.deletions}</Text>
                                  <Text style={styles.listItemMeta}>{prDetail.changed_files} bestanden · {prDetail.commits} commits</Text>
                                </View>
                              </View>

                              {/* Changed files */}
                              <Text style={styles.commentSectionTitle}>
                                Gewijzigde bestanden ({loadingPRFiles ? '...' : prFiles.length})
                              </Text>
                              {loadingPRFiles ? (
                                <ActivityIndicator color={accentColor} style={{ marginTop: 10 }} />
                              ) : (
                                prFiles.map((f) => (
                                  <TouchableOpacity
                                    key={f.filename}
                                    style={styles.listItem}
                                    activeOpacity={0.7}
                                    onPress={() => f.patch && setViewingPRDiff({ filename: f.filename, patch: f.patch })}
                                  >
                                    <Ionicons
                                      name={f.status === 'added' ? 'add-circle-outline' : f.status === 'removed' ? 'remove-circle-outline' : 'create-outline'}
                                      size={14}
                                      color={f.status === 'added' ? '#4ade80' : f.status === 'removed' ? '#ef4444' : '#f59e0b'}
                                      style={{ marginRight: 8, marginTop: 2 }}
                                    />
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.listItemTitle} numberOfLines={1}>{f.filename}</Text>
                                      <Text style={styles.listItemMeta}>
                                        <Text style={{ color: '#4ade80' }}>+{f.additions}</Text> <Text style={{ color: '#ef4444' }}>-{f.deletions}</Text>
                                      </Text>
                                    </View>
                                    {f.patch && <Ionicons name="chevron-forward" size={14} color="#555" />}
                                  </TouchableOpacity>
                                ))
                              )}

                              {/* Comments */}
                              <Text style={styles.commentSectionTitle}>
                                Reacties ({loadingPRComments ? '...' : prComments.length})
                              </Text>
                              {loadingPRComments ? (
                                <ActivityIndicator color={accentColor} style={{ marginTop: 10 }} />
                              ) : prComments.length === 0 ? (
                                <Text style={[styles.emptyTabText, { paddingTop: 8 }]}>Geen reacties</Text>
                              ) : (
                                prComments.map((c) => (
                                  <View key={c.id} style={styles.commentItem}>
                                    <Text style={styles.commentAuthor}>{c.user.login} <Text style={styles.listItemMeta}>· {timeAgo(c.created_at)}</Text></Text>
                                    <Text style={styles.commentBody}>{c.body}</Text>
                                  </View>
                                ))
                              )}

                              {/* Comment input */}
                              <View style={styles.commentInputRow}>
                                <TextInput
                                  style={styles.commentInput}
                                  placeholder="Schrijf een reactie..."
                                  placeholderTextColor="#555"
                                  value={prCommentText}
                                  onChangeText={setPrCommentText}
                                  multiline
                                />
                                <TouchableOpacity
                                  style={[styles.commentSendBtn, { backgroundColor: accentColor, opacity: prCommentText.trim() ? 1 : 0.5 }]}
                                  onPress={postPRComment}
                                  disabled={submitting || !prCommentText.trim()}
                                >
                                  {submitting ? (
                                    <ActivityIndicator color="#0a0a0a" size="small" />
                                  ) : (
                                    <Ionicons name="send" size={16} color="#0a0a0a" />
                                  )}
                                </TouchableOpacity>
                              </View>

                              {/* Action buttons */}
                              {!prDetail.merged && prDetail.state === 'open' && (
                                <View style={{ marginTop: 8 }}>
                                  {/* Merge method selector */}
                                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                                    {(['merge', 'squash', 'rebase'] as const).map((m) => (
                                      <TouchableOpacity
                                        key={m}
                                        style={[styles.branchChip, mergeMethod === m && { borderColor: '#4ade80', backgroundColor: '#4ade8020' }]}
                                        onPress={() => setMergeMethod(m)}
                                      >
                                        <Text style={[styles.branchChipText, mergeMethod === m && { color: '#4ade80' }]}>
                                          {m === 'merge' ? 'Merge' : m === 'squash' ? 'Squash' : 'Rebase'}
                                        </Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                  <TouchableOpacity
                                    style={[styles.issueActionBtn, { borderColor: '#4ade80' }]}
                                    onPress={() => {
                                      showAlert('Mergen', `Weet je zeker dat je #${prDetail.number} wilt ${mergeMethod}en?`, [
                                        { text: 'Annuleren', style: 'cancel' },
                                        { text: 'Mergen', style: 'default', onPress: mergePR },
                                      ]);
                                    }}
                                    disabled={submitting}
                                  >
                                    <Ionicons name="git-merge" size={16} color="#4ade80" style={{ marginRight: 6 }} />
                                    <Text style={{ color: '#4ade80', fontWeight: '600', fontSize: 14 }}>
                                      {mergeMethod === 'merge' ? 'Merge' : mergeMethod === 'squash' ? 'Squash & Merge' : 'Rebase & Merge'}
                                    </Text>
                                  </TouchableOpacity>
                                </View>
                              )}
                              <TouchableOpacity
                                style={[styles.issueActionBtn, {
                                  borderColor: prDetail.state === 'open' ? '#ef4444' : '#4ade80',
                                  marginTop: 8,
                                }]}
                                onPress={closePR}
                                disabled={submitting || prDetail.merged}
                              >
                                <Ionicons
                                  name={prDetail.state === 'open' ? 'close-circle-outline' : 'checkmark-circle-outline'}
                                  size={16}
                                  color={prDetail.state === 'open' ? '#ef4444' : '#4ade80'}
                                  style={{ marginRight: 6 }}
                                />
                                <Text style={{
                                  color: prDetail.state === 'open' ? '#ef4444' : '#4ade80',
                                  fontWeight: '600', fontSize: 14,
                                }}>
                                  {prDetail.state === 'open' ? 'PR sluiten' : 'PR heropenen'}
                                </Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                      )
                    ) : (
                      showNewPR ? (
                      // New PR form
                      <View style={styles.newBranchForm}>
                        <TextInput
                          style={styles.newBranchInput}
                          placeholder="Titel *"
                          placeholderTextColor="#555"
                          value={newPRTitle}
                          onChangeText={setNewPRTitle}
                        />
                        <TextInput
                          style={[styles.newBranchInput, { minHeight: 80, textAlignVertical: 'top' }]}
                          placeholder="Beschrijving (optioneel)"
                          placeholderTextColor="#555"
                          value={newPRBody}
                          onChangeText={setNewPRBody}
                          multiline
                        />
                        <Text style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>Head branch (bron)</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                          {branches.map((b) => (
                            <TouchableOpacity
                              key={b.name}
                              style={[styles.branchChip, newPRHead === b.name && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                              onPress={() => setNewPRHead(b.name)}
                            >
                              <Text style={[styles.branchChipText, newPRHead === b.name && { color: accentColor }]}>{b.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <Text style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>Base branch (doel)</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                          {branches.map((b) => (
                            <TouchableOpacity
                              key={b.name}
                              style={[styles.branchChip, newPRBase === b.name && { borderColor: '#a78bfa', backgroundColor: '#a78bfa20' }]}
                              onPress={() => setNewPRBase(b.name)}
                            >
                              <Text style={[styles.branchChipText, newPRBase === b.name && { color: '#a78bfa' }]}>{b.name}</Text>
                            </TouchableOpacity>
                          ))}
                        </ScrollView>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: accentColor, opacity: newPRTitle.trim() && newPRHead && newPRBase ? 1 : 0.5, flex: 1 }]}
                            onPress={createPR}
                            disabled={submitting || !newPRTitle.trim() || !newPRHead || !newPRBase}
                          >
                            {submitting ? (
                              <ActivityIndicator color="#0a0a0a" size="small" />
                            ) : (
                              <Text style={styles.newBranchBtnText}>Aanmaken</Text>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: '#222', flex: 1 }]}
                            onPress={() => { setShowNewPR(false); setNewPRTitle(''); setNewPRBody(''); setNewPRHead(''); setNewPRBase(''); }}
                          >
                            <Text style={[styles.newBranchBtnText, { color: '#888' }]}>Annuleren</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      // PR list
                      <View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 }}>
                          <TouchableOpacity
                            style={[styles.branchChip, prFilter === 'open' && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                            onPress={() => setPrFilter('open')}
                          >
                            <Text style={[styles.branchChipText, prFilter === 'open' && { color: accentColor }]}>Open</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.branchChip, prFilter === 'closed' && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                            onPress={() => setPrFilter('closed')}
                          >
                            <Text style={[styles.branchChipText, prFilter === 'closed' && { color: accentColor }]}>Gesloten</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: accentColor, marginLeft: 'auto', paddingHorizontal: 12 }]}
                            onPress={() => setShowNewPR(true)}
                          >
                            <Ionicons name="add" size={14} color="#0a0a0a" style={{ marginRight: 2 }} />
                            <Text style={styles.newBranchBtnText}>Nieuw</Text>
                          </TouchableOpacity>
                        </View>
                        {loadingPRs ? (
                          <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                        ) : pulls.length === 0 ? (
                          <Text style={styles.emptyTabText}>Geen {prFilter === 'open' ? 'open' : 'gesloten'} pull requests</Text>
                        ) : (
                          pulls.map((pr) => (
                            <TouchableOpacity
                              key={pr.id}
                              style={styles.listItem}
                              activeOpacity={0.7}
                              onPress={() => setViewingPR(pr.number)}
                            >
                              <Ionicons
                                name="git-pull-request"
                                size={16}
                                color={pr.draft ? '#888' : '#a78bfa'}
                                style={{ marginRight: 8, marginTop: 2 }}
                              />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.listItemTitle} numberOfLines={2}>
                                  #{pr.number} {pr.title}
                                  {pr.draft && <Text style={{ color: '#888' }}> (draft)</Text>}
                                </Text>
                                <Text style={styles.listItemMeta}>
                                  {pr.user.login} · {timeAgo(pr.created_at)}
                                </Text>
                                {pr.labels.length > 0 && (
                                  <View style={styles.labelRow}>
                                    {pr.labels.slice(0, 3).map((l) => (
                                      <View
                                        key={l.name}
                                        style={[styles.label, { backgroundColor: `#${l.color}30`, borderColor: `#${l.color}60` }]}
                                      >
                                        <Text style={[styles.labelText, { color: `#${l.color}` }]}>{l.name}</Text>
                                      </View>
                                    ))}
                                  </View>
                                )}
                              </View>
                              <Ionicons name="chevron-forward" size={14} color="#555" />
                            </TouchableOpacity>
                          ))
                        )}
                      </View>
                    ))
                  )}

                  {detailTab === 'actions' && (
                    loadingActions ? (
                      <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                    ) : actions.length === 0 ? (
                      <Text style={styles.emptyTabText}>Geen workflow runs</Text>
                    ) : (
                      actions.map((run) => {
                        const icon = getRunIcon(run);
                        return (
                          <View key={run.id} style={styles.listItem}>
                            <Ionicons
                              name={icon.name as any}
                              size={16}
                              color={icon.color}
                              style={{ marginRight: 8, marginTop: 2 }}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.listItemTitle} numberOfLines={1}>
                                {run.name}
                              </Text>
                              <Text style={styles.listItemMeta}>
                                {run.head_branch} · {run.event} · {timeAgo(run.created_at)}
                              </Text>
                            </View>
                          </View>
                        );
                      })
                    )
                  )}

                  {detailTab === 'branches' && (
                    loadingBranches ? (
                      <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                    ) : (
                      <View>
                        {/* New branch form */}
                        {showNewBranch ? (
                          <View style={styles.newBranchForm}>
                            <TextInput
                              style={styles.newBranchInput}
                              placeholder="Branch naam..."
                              placeholderTextColor="#555"
                              value={newBranchName}
                              onChangeText={setNewBranchName}
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                            <Text style={styles.newBranchLabel}>Gebaseerd op:</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                              {branches.map((b) => (
                                <TouchableOpacity
                                  key={b.name}
                                  style={[styles.branchChip, newBranchBase === b.name && { borderColor: accentColor, backgroundColor: accentColor + '20' }]}
                                  onPress={() => setNewBranchBase(b.name)}
                                >
                                  <Text style={[styles.branchChipText, newBranchBase === b.name && { color: accentColor }]}>{b.name}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <TouchableOpacity
                                style={[styles.newBranchBtn, { backgroundColor: accentColor, opacity: newBranchName.trim() && newBranchBase ? 1 : 0.5, flex: 1 }]}
                                onPress={createBranch}
                                disabled={!newBranchName.trim() || !newBranchBase}
                              >
                                <Text style={styles.newBranchBtnText}>Aanmaken</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.newBranchBtn, { backgroundColor: '#222', flex: 1 }]}
                                onPress={() => { setShowNewBranch(false); setNewBranchName(''); setNewBranchBase(''); }}
                              >
                                <Text style={[styles.newBranchBtnText, { color: '#888' }]}>Annuleren</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[styles.newBranchBtn, { backgroundColor: accentColor, marginVertical: 10 }]}
                            onPress={() => setShowNewBranch(true)}
                          >
                            <Ionicons name="add" size={16} color="#0a0a0a" style={{ marginRight: 4 }} />
                            <Text style={styles.newBranchBtnText}>Nieuwe branch</Text>
                          </TouchableOpacity>
                        )}

                        {branches.length === 0 ? (
                          <Text style={styles.emptyTabText}>Geen branches</Text>
                        ) : (
                          branches.map((branch) => (
                            <TouchableOpacity
                              key={branch.name}
                              style={styles.listItem}
                              activeOpacity={0.7}
                              onPress={() => {
                                setSelectedBranch(branch.name);
                                setFilePath([]);
                                setViewingFile(null);
                                setDetailTab('files');
                              }}
                            >
                              <Ionicons
                                name="git-branch-outline"
                                size={16}
                                color={branch.protected ? '#f59e0b' : '#888'}
                                style={{ marginRight: 8, marginTop: 2 }}
                              />
                              <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <Text style={styles.listItemTitle} numberOfLines={1}>{branch.name}</Text>
                                  {branch.protected && (
                                    <Ionicons name="shield-checkmark" size={12} color="#f59e0b" />
                                  )}
                                </View>
                                <Text style={styles.listItemMeta}>{branch.commit.sha.slice(0, 7)}</Text>
                              </View>
                              {!branch.protected && (
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    showAlert('Branch verwijderen?', `Weet je zeker dat je "${branch.name}" wilt verwijderen?`, [
                                      { text: 'Annuleren', style: 'cancel' },
                                      { text: 'Verwijderen', style: 'destructive', onPress: () => deleteBranch(branch.name) },
                                    ]);
                                  }}
                                >
                                  <Ionicons name="trash-outline" size={16} color="#ef4444" />
                                </TouchableOpacity>
                              )}
                              <Ionicons name="chevron-forward" size={14} color="#555" style={{ marginLeft: 8 }} />
                            </TouchableOpacity>
                          ))
                        )}
                      </View>
                    )
                  )}

                  {detailTab === 'releases' && (
                    loadingReleases ? (
                      <ActivityIndicator color={accentColor} style={{ marginTop: 20 }} />
                    ) : releases.length === 0 ? (
                      <Text style={styles.emptyTabText}>Geen releases</Text>
                    ) : (
                      releases.map((rel) => (
                        <View key={rel.id} style={styles.listItem}>
                          <Ionicons
                            name="pricetag-outline"
                            size={16}
                            color={rel.prerelease ? '#f59e0b' : accentColor}
                            style={{ marginRight: 8, marginTop: 2 }}
                          />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.listItemTitle} numberOfLines={1}>
                                {rel.name || rel.tag_name}
                              </Text>
                              {rel.prerelease && (
                                <View style={[styles.label, { backgroundColor: '#f59e0b20', borderColor: '#f59e0b60' }]}>
                                  <Text style={[styles.labelText, { color: '#f59e0b' }]}>pre-release</Text>
                                </View>
                              )}
                              {rel.draft && (
                                <View style={[styles.label, { backgroundColor: '#88888820', borderColor: '#88888860' }]}>
                                  <Text style={[styles.labelText, { color: '#888' }]}>draft</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.listItemMeta}>
                              {rel.tag_name} · {rel.author.login} · {timeAgo(rel.published_at)}
                            </Text>
                            {rel.body && (
                              <Text style={styles.releaseBody} numberOfLines={3}>{rel.body}</Text>
                            )}
                            {rel.assets.length > 0 && (
                              <Text style={styles.listItemMeta}>
                                {rel.assets.length} {rel.assets.length === 1 ? 'bestand' : 'bestanden'} · {rel.assets.reduce((sum, a) => sum + a.download_count, 0)} downloads
                              </Text>
                            )}
                          </View>
                        </View>
                      ))
                    )
                  )}
                </ScrollView>

                {/* Git action buttons with animation */}
                <Animated.View style={[styles.gitActionRow, {
                  transform: [{
                    scale: gitActionAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.05],
                    }),
                  }],
                }]}>
                  <TouchableOpacity
                    style={[styles.gitActionBtn, { backgroundColor: accentColor }]}
                    onPress={() => cloneToTerminal(selectedRepo)}
                    disabled={!!gitActionLoading}
                  >
                    {gitActionLoading === 'clone' ? (
                      <ActivityIndicator size="small" color="#0a0a0a" style={{ marginRight: 4 }} />
                    ) : (
                      <Ionicons name="download-outline" size={16} color="#0a0a0a" style={{ marginRight: 4 }} />
                    )}
                    <Text style={styles.cloneButtonText}>Clone</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.gitActionBtn, { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' }]}
                    onPress={() => {
                      const dir = editorProjectPath;
                      const cmd = dir ? `cd "${dir}" && git pull` : 'git pull';
                      runInTerminal(cmd, 'pull');
                    }}
                    disabled={!!gitActionLoading}
                  >
                    {gitActionLoading === 'pull' ? (
                      <ActivityIndicator size="small" color="#e0e0e0" style={{ marginRight: 4 }} />
                    ) : (
                      <Ionicons name="arrow-down-outline" size={16} color="#e0e0e0" style={{ marginRight: 4 }} />
                    )}
                    <Text style={[styles.cloneButtonText, { color: '#e0e0e0' }]}>Pull</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.gitActionBtn, { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' }]}
                    onPress={() => {
                      const dir = editorProjectPath;
                      const cmd = dir ? `cd "${dir}" && git push` : 'git push';
                      runInTerminal(cmd, 'push');
                    }}
                    disabled={!!gitActionLoading}
                  >
                    {gitActionLoading === 'push' ? (
                      <ActivityIndicator size="small" color="#e0e0e0" style={{ marginRight: 4 }} />
                    ) : (
                      <Ionicons name="arrow-up-outline" size={16} color="#e0e0e0" style={{ marginRight: 4 }} />
                    )}
                    <Text style={[styles.cloneButtonText, { color: '#e0e0e0' }]}>Push</Text>
                  </TouchableOpacity>
                </Animated.View>
        </Animated.View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  // Login
  loginScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  loginContainer: {
    alignItems: 'center',
    paddingHorizontal: 40,
    paddingVertical: 40,
  },
  loginIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  loginTitle: {
    color: '#e0e0e0',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
  loginSubtitle: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 32,
  },
  loginHint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  tokenInput: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 10,
    color: '#e0e0e0',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: '100%',
    marginBottom: 16,
  },
  loginButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '100%',
  },
  loginButtonText: {
    color: '#0a0a0a',
    fontSize: 16,
    fontWeight: '700',
  },
  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141414',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  searchInput: {
    flex: 1,
    color: '#e0e0e0',
    fontSize: 14,
    padding: 0,
  },
  repoCount: {
    color: '#666',
    fontSize: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  // Repo card
  repoCard: {
    backgroundColor: '#111',
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  repoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  repoNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  repoName: {
    color: '#e0e0e0',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  langBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  langDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  langText: {
    color: '#888',
    fontSize: 12,
  },
  repoDesc: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  repoMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  metaText: {
    color: '#888',
    fontSize: 12,
  },
  metaTime: {
    color: '#555',
    fontSize: 12,
    marginLeft: 'auto',
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: '#555',
    fontSize: 14,
    marginTop: 12,
  },
  // Modal
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0f0f0f',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 16,
  },
  dragArea: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#111',
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#444',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  modalTitle: {
    color: '#e0e0e0',
    fontSize: 18,
    fontWeight: '700',
  },
  modalOwner: {
    color: '#666',
    fontSize: 13,
    marginTop: 2,
  },
  modalDesc: {
    color: '#888',
    fontSize: 13,
    paddingHorizontal: 20,
    paddingBottom: 12,
    lineHeight: 18,
  },
  // Tabs
  tabRow: {
    width: '100%',
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  tabRowContent: {
    flexDirection: 'row',
    paddingHorizontal: 8,
  },
  tab: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 2,
    paddingHorizontal: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabText: {
    color: '#888',
    fontSize: 13,
    lineHeight: 14,
    fontWeight: '600',
  },
  tabContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  emptyTabText: {
    color: '#555',
    fontSize: 13,
    textAlign: 'center',
    paddingTop: 24,
  },
  // List items
  listItem: {
    flexDirection: 'row',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  listItemTitle: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 19,
  },
  listItemMeta: {
    color: '#666',
    fontSize: 12,
    marginTop: 3,
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  labelText: {
    fontSize: 10,
    fontWeight: '600',
  },
  // Commit detail
  commitDetailMessage: {
    color: '#e0e0e0',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  commitDetailStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  commitStatAdd: {
    fontSize: 13,
    fontWeight: '600',
  },
  commitStatDel: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Diff viewer
  diffContainer: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginBottom: 8,
    maxHeight: 250,
    padding: 4,
  },
  diffLine: {
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  diffLineAdd: {
    backgroundColor: '#4ade8015',
  },
  diffLineDel: {
    backgroundColor: '#ef444415',
  },
  diffLineHunk: {
    backgroundColor: '#a78bfa10',
  },
  diffLineText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#ccc',
    lineHeight: 16,
  },
  // Branch indicator
  branchIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  // File browser
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    flexWrap: 'wrap',
    gap: 2,
  },
  breadcrumbSep: {
    color: '#555',
    fontSize: 13,
    marginHorizontal: 4,
  },
  breadcrumbText: {
    fontSize: 13,
    fontWeight: '500',
  },
  fileViewerContainer: {
    backgroundColor: '#111',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    marginTop: 8,
    maxHeight: 280,
    padding: 12,
  },
  fileViewerText: {
    color: '#e0e0e0',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  // Branches
  newBranchForm: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  newBranchInput: {
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    color: '#e0e0e0',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  newBranchLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  branchChip: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
  },
  branchChipText: {
    color: '#888',
    fontSize: 12,
  },
  newBranchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  newBranchBtnText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '600',
  },
  // Issues
  issueStateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  issueBody: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  commentSectionTitle: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
    paddingTop: 12,
    paddingBottom: 4,
  },
  commentItem: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  commentAuthor: {
    color: '#e0e0e0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  commentBody: {
    color: '#aaa',
    fontSize: 13,
    lineHeight: 18,
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginTop: 12,
    marginBottom: 8,
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    color: '#e0e0e0',
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxHeight: 80,
  },
  commentSendBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  issueActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 8,
  },
  // Releases
  releaseBody: {
    color: '#777',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  // Clone button
  cloneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
  },
  cloneButtonText: {
    color: '#0a0a0a',
    fontSize: 15,
    fontWeight: '700',
  },
  gitActionRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  gitActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
});
