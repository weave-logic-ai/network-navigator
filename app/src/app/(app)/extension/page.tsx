"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Globe,
  FileText,
  CheckCircle,
  Clock,
  Loader2,
  Play,
  RefreshCw,
  Shield,
  Database,
  Trash2,
} from "lucide-react";

interface Capture {
  id: string;
  url: string;
  pageType: string;
  contentLength: number;
  parsed: boolean;
  parsedAt: string | null;
  parseVersion: number | null;
  triggerMode: string | null;
  scrollDepth: number | null;
  extensionVersion: string | null;
  createdAt: string;
}

interface ParseResult {
  success: boolean;
  pageType: string;
  fieldsExtracted: number;
  fieldsAttempted: number;
  overallConfidence: number;
  parseTimeMs: number;
  errors: string[];
}

interface ExtHealth {
  status: string;
  dbConnected: boolean;
  wsConnected: boolean;
  pendingParseJobs: number;
  uptime: number;
}

interface TokenInfo {
  token: string;
  extensionId: string;
  createdAt: string;
  lastUsedAt: string | null;
  isRevoked: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const PAGE_TYPE_COLORS: Record<string, string> = {
  PROFILE: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  SEARCH_PEOPLE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  FEED: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  COMPANY: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  CONNECTIONS: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  MESSAGES: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  OTHER: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

export default function ExtensionPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [health, setHealth] = useState<ExtHealth | null>(null);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Capture | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [autoParse, setAutoParse] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("ext-auto-parse") === "true";
    }
    return false;
  });
  const [autoParsingIds, setAutoParsingIds] = useState<Set<string>>(new Set());

  function toggleAutoParse() {
    setAutoParse((prev) => {
      const next = !prev;
      localStorage.setItem("ext-auto-parse", String(next));
      return next;
    });
  }

  const loadData = useCallback(async () => {
    try {
      const [capturesRes, tokensRes] = await Promise.all([
        fetch("/api/extension/captures"),
        fetch("/api/extension/tokens"),
      ]);

      if (capturesRes.ok) {
        const json = await capturesRes.json();
        setCaptures(json.data || []);
      }

      if (tokensRes.ok) {
        const json = await tokensRes.json();
        setTokens(json.data || []);
      }

      // Health check (may fail if no token)
      try {
        const healthRes = await fetch("/api/extension/health-internal");
        if (healthRes.ok) {
          const json = await healthRes.json();
          setHealth(json);
        }
      } catch {
        // Health check optional
      }
    } catch {
      // Handle errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Auto-parse: when new unparsed captures appear, parse them
  useEffect(() => {
    if (!autoParse) return;
    const unparsed = captures.filter(
      (c) => !c.parsed && c.pageType !== "OTHER" && !autoParsingIds.has(c.id)
    );
    if (unparsed.length === 0) return;

    for (const capture of unparsed) {
      setAutoParsingIds((prev) => new Set(prev).add(capture.id));
      fetch("/api/extension/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId: capture.id }),
      })
        .then((res) => {
          if (res.ok) return res.json();
        })
        .then((json) => {
          if (json?.data) setParseResult(json.data);
        })
        .catch(() => {})
        .finally(() => {
          // Refresh to show updated parsed state
          loadData();
        });
    }
  }, [captures, autoParse, autoParsingIds, loadData]);

  async function handleParse(captureId: string) {
    setParsing(captureId);
    setParseResult(null);
    try {
      const res = await fetch("/api/extension/captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureId }),
      });
      if (res.ok) {
        const json = await res.json();
        setParseResult(json.data);
        await loadData(); // Refresh captures list
      }
    } catch {
      // Handle error
    } finally {
      setParsing(null);
    }
  }

  async function handleGenerateToken() {
    setGeneratingToken(true);
    setNewToken(null);
    setTokenCopied(false);
    try {
      const res = await fetch("/api/extension/tokens", {
        method: "POST",
      });
      if (res.ok) {
        const json = await res.json();
        setNewToken(json.data?.token ?? null);
        await loadData();
      }
    } catch {
      // Handle error
    } finally {
      setGeneratingToken(false);
    }
  }

  async function handleRevokeToken() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await fetch(`/api/extension/tokens/${revokeTarget}`, { method: "DELETE" });
      setRevokeTarget(null);
      await loadData();
    } catch {
      // Handle error
    } finally {
      setRevoking(false);
    }
  }

  function copyToken() {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/extension/captures/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteTarget(null);
        await loadData();
      }
    } catch {
      // Handle error
    } finally {
      setDeleting(false);
    }
  }

  const unparsedCount = captures.filter((c) => !c.parsed).length;
  const parsedCount = captures.filter((c) => c.parsed).length;
  const totalSize = captures.reduce((s, c) => s + c.contentLength, 0);

  return (
    <div>
      <PageHeader
        title="Extension"
        description="Chrome extension management, capture logs, and parsing results"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={autoParse}
                onClick={toggleAutoParse}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${autoParse ? "bg-primary" : "bg-input"}`}
              >
                <span className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg transition-transform ${autoParse ? "translate-x-4" : "translate-x-0"}`} />
              </button>
              <span className="text-muted-foreground text-xs">Auto-parse</span>
            </label>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-6 text-center">
            <Database className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold">{captures.length}</p>
            <p className="text-xs text-muted-foreground">Total Captures</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle className="h-5 w-5 mx-auto mb-1 text-green-500" />
            <p className="text-2xl font-bold">{parsedCount}</p>
            <p className="text-xs text-muted-foreground">Parsed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Clock className="h-5 w-5 mx-auto mb-1 text-yellow-500" />
            <p className="text-2xl font-bold">{unparsedCount}</p>
            <p className="text-xs text-muted-foreground">Pending Parse</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <FileText className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-2xl font-bold">{formatBytes(totalSize)}</p>
            <p className="text-xs text-muted-foreground">Total Captured</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Captures Log */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capture Log</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : captures.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No captures yet. Install the Chrome extension and capture a
                LinkedIn page.
              </p>
            ) : (
              <div className="space-y-2">
                {captures.map((capture) => (
                  <div
                    key={capture.id}
                    className="flex items-center gap-3 rounded-md border p-3"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] ${PAGE_TYPE_COLORS[capture.pageType] || PAGE_TYPE_COLORS.OTHER}`}
                        >
                          {capture.pageType}
                        </Badge>
                        {capture.parsed ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-green-600"
                          >
                            <CheckCircle className="h-2.5 w-2.5 mr-1" />
                            Parsed
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] text-yellow-600"
                          >
                            <Clock className="h-2.5 w-2.5 mr-1" />
                            Pending
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {formatBytes(capture.contentLength)}
                        </span>
                      </div>
                      <p className="text-sm truncate">
                        <Globe className="h-3 w-3 inline mr-1 text-muted-foreground" />
                        {capture.url}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatTimeAgo(capture.createdAt)}
                        {capture.scrollDepth != null &&
                          ` · ${Math.round(capture.scrollDepth * 100)}% scroll`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!capture.parsed && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleParse(capture.id)}
                          disabled={parsing === capture.id}
                          title="Parse this capture"
                        >
                          {parsing === capture.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(capture)}
                        title="Delete capture"
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Parse Result */}
            {parseResult && (
              <>
                <Separator className="my-4" />
                <div className="rounded-md border p-3 bg-muted/30">
                  <p className="text-sm font-medium mb-2">
                    Parse Result{" "}
                    {parseResult.success ? (
                      <span className="text-green-600">Success</span>
                    ) : (
                      <span className="text-red-600">Failed</span>
                    )}
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Fields: </span>
                      {parseResult.fieldsExtracted}/{parseResult.fieldsAttempted}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Confidence: </span>
                      {(parseResult.overallConfidence * 100).toFixed(0)}%
                    </div>
                    <div>
                      <span className="text-muted-foreground">Time: </span>
                      {parseResult.parseTimeMs}ms
                    </div>
                  </div>
                  {parseResult.errors.length > 0 && (
                    <div className="mt-2 text-xs text-red-600">
                      {parseResult.errors.map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: Tokens + Health */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Extension Tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              {tokens.filter((t) => !t.isRevoked).length === 0 ? (
                <p className="text-sm text-muted-foreground mb-3">
                  No active tokens. Generate one to connect the extension.
                </p>
              ) : (
                <div className="space-y-2 mb-3">
                  {tokens.filter((t) => !t.isRevoked).map((t) => (
                    <div key={t.extensionId} className="text-xs border rounded p-2">
                      <div className="flex items-center justify-between">
                        <code className="font-mono">{t.token}</code>
                        <div className="flex items-center gap-1">
                          <Badge variant="default" className="text-[9px]">
                            Active
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => setRevokeTarget(t.extensionId)}
                            title="Revoke token"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-muted-foreground mt-1">
                        {t.lastUsedAt
                          ? `Last used ${formatTimeAgo(t.lastUsedAt)}`
                          : "Never used"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleGenerateToken}
                disabled={generatingToken}
              >
                {generatingToken ? "Generating..." : "Generate New Token"}
              </Button>
            </CardContent>
          </Card>

          {health && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Extension Health</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge
                    variant={health.status === "healthy" ? "default" : "secondary"}
                  >
                    {health.status}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">DB</span>
                  <span>{health.dbConnected ? "Connected" : "Down"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Parse Queue</span>
                  <span>{health.pendingParseJobs}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* New Token Dialog */}
      <Dialog open={!!newToken} onOpenChange={(open) => { if (!open) setNewToken(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token Generated</DialogTitle>
            <DialogDescription>
              Copy this token now. It will not be shown again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/30 p-4">
            <code className="font-mono text-sm break-all select-all">{newToken}</code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewToken(null)}>
              Close
            </Button>
            <Button onClick={copyToken}>
              {tokenCopied ? (
                <>
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                  Copied!
                </>
              ) : (
                "Copy Token"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Token Confirmation Dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Token</DialogTitle>
            <DialogDescription>
              This will permanently revoke this extension token. Any extension using it will lose access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevokeToken} disabled={revoking}>
              {revoking ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Revoking...
                </>
              ) : (
                "Revoke Token"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Capture</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this capture? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className={`text-[10px] ${PAGE_TYPE_COLORS[deleteTarget.pageType] || PAGE_TYPE_COLORS.OTHER}`}>
                  {deleteTarget.pageType}
                </Badge>
                <span className="text-muted-foreground text-xs">{formatBytes(deleteTarget.contentLength)}</span>
              </div>
              <p className="truncate text-muted-foreground">
                {deleteTarget.url}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
