import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Badge } from './ui/badge';
import { toast } from 'sonner';
import { Copy, Key, Trash2, Plus, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '../hooks/useApiKeys';

const MCP_URL = 'https://ilyol-uqaaa-aaaai-q34kq-cai.icp0.io/mcp';

export function ApiKeysManager() {
  const { data: keys, isLoading: loading, refetch } = useApiKeys();
  const { mutateAsync: createKey, isPending: isCreating } = useCreateApiKey();
  const { mutateAsync: revokeKey, isPending: isRevoking } = useRevokeApiKey();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<{ id: string; name: string } | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const isPending = isCreating || isRevoking;

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;

    try {
      const rawKey = await createKey({ name: newKeyName.trim(), scopes: ['all'] });
      setNewApiKey(rawKey);
      setShowCreateDialog(false);
      setShowNewKeyDialog(true);
      setNewKeyName('');
      toast.success('API key created successfully!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create API key');
    }
  };

  const handleRevokeKey = async () => {
    if (!keyToRevoke) return;

    try {
      await revokeKey(keyToRevoke.id);
      setShowRevokeDialog(false);
      setKeyToRevoke(null);
      toast.success('API key revoked successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const toggleRevealKey = (keyId: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      if (next.has(keyId)) next.delete(keyId);
      else next.add(keyId);
      return next;
    });
  };

  const maskKey = (key: string) => {
    if (key.length < 12) return key;
    return `${key.slice(0, 8)}...${key.slice(-4)}`;
  };

  const keysList = keys ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Keys
              </CardTitle>
              <CardDescription>
                Manage API keys for MCP integration and external access
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCreateDialog(true)}
                disabled={loading || isPending}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Key
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* MCP Server Configuration */}
          <div className="mb-6 p-5 bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 rounded-lg space-y-4">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-500/20 rounded-md">
                <Key className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                  MCP Server Configuration
                </p>
                <p className="text-xs text-muted-foreground">
                  Use these settings to connect your MCP client
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Header Name</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-background rounded-md border text-sm font-mono">
                    x-api-key
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard('x-api-key', 'Header name')} className="shrink-0">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">MCP Server URL</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-background rounded-md border text-sm font-mono break-all">
                    {MCP_URL}
                  </code>
                  <Button size="sm" variant="outline" onClick={() => copyToClipboard(MCP_URL, 'MCP URL')} className="shrink-0">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {keysList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Key className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p>{loading ? 'Loading keys...' : 'No API keys yet'}</p>
              <p className="text-sm mt-1">Create a key to use with MCP tools and external integrations</p>
            </div>
          ) : (
            <div className="space-y-3">
              {keysList.map((key: any) => (
                <div
                  key={key.hashed_key}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{key.info.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {key.info.scopes.join(', ')}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        onClick={() => toggleRevealKey(key.hashed_key)}
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        {revealedKeys.has(key.hashed_key) ? (
                          <>
                            <EyeOff className="h-3 w-3" />
                            <span className="mr-1">Key ID:</span>
                            <code className="font-mono">{key.hashed_key}</code>
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            <span className="mr-1">Key ID:</span>
                            <code className="font-mono">{maskKey(key.hashed_key)}</code>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setKeyToRevoke({ id: key.hashed_key, name: key.info.name });
                      setShowRevokeDialog(true);
                    }}
                    disabled={isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Key Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New API Key</DialogTitle>
            <DialogDescription>
              Give your API key a descriptive name. The key will have full access to your account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="key-name">Key Name</label>
              <Input
                id="key-name"
                placeholder="e.g., MCP Claude Desktop, Production Bot"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                maxLength={50}
              />
              <p className="text-xs text-muted-foreground">
                Choose a name that helps you identify where this key is used
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreateKey} disabled={isPending || !newKeyName.trim()} className="flex-1">
              {isCreating ? 'Creating...' : 'Create Key'}
            </Button>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Key Display Dialog */}
      <Dialog open={showNewKeyDialog} onOpenChange={setShowNewKeyDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <Key className="h-5 w-5" />
              Save Your API Key
            </DialogTitle>
            <DialogDescription>
              This is the only time you'll see this key. Copy it now and store it securely!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <label className="text-xs text-muted-foreground">Your New API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-background rounded border text-sm font-mono break-all">
                  {newApiKey}
                </code>
                <Button size="sm" variant="outline" onClick={() => copyToClipboard(newApiKey, 'API key')}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
              <p className="text-sm text-orange-600 dark:text-orange-400">
                ⚠️ Make sure to copy this key now. You won't be able to see it again!
              </p>
            </div>
          </div>
          <Button onClick={() => setShowNewKeyDialog(false)} className="w-full">
            I've Saved My Key
          </Button>
        </DialogContent>
      </Dialog>

      {/* Revoke Key Confirmation Dialog */}
      <Dialog open={showRevokeDialog} onOpenChange={setShowRevokeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Revoke API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke the API key "{keyToRevoke?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button variant="destructive" onClick={handleRevokeKey} disabled={isPending} className="flex-1">
              {isRevoking ? 'Revoking...' : 'Revoke Key'}
            </Button>
            <Button variant="outline" onClick={() => { setShowRevokeDialog(false); setKeyToRevoke(null); }} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
