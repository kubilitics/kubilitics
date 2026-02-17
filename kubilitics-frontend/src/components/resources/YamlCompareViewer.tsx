import { useState, useMemo } from 'react';
import { GitCompare, Copy, Download, ChevronLeft, ChevronRight, Plus, Minus, Equal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { toast } from 'sonner';

export interface YamlVersion {
  id: string;
  label: string;
  yaml: string;
  timestamp?: string;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged' | 'modified';
  lineNumber: { left?: number; right?: number };
  content: { left?: string; right?: string };
}

export interface YamlCompareViewerProps {
  versions: YamlVersion[];
  resourceName: string;
  onSelectVersion?: (version: YamlVersion) => void;
}

export function computeDiff(leftYaml: string, rightYaml: string): DiffLine[] {
  const leftLines = leftYaml.split('\n');
  const rightLines = rightYaml.split('\n');
  const result: DiffLine[] = [];
  
  const m = leftLines.length;
  const n = rightLines.length;
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  
  let i = m, j = n;
  const diffReverse: DiffLine[] = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      diffReverse.push({
        type: 'unchanged',
        lineNumber: { left: i, right: j },
        content: { left: leftLines[i - 1], right: rightLines[j - 1] }
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffReverse.push({
        type: 'added',
        lineNumber: { right: j },
        content: { right: rightLines[j - 1] }
      });
      j--;
    } else {
      diffReverse.push({
        type: 'removed',
        lineNumber: { left: i },
        content: { left: leftLines[i - 1] }
      });
      i--;
    }
  }
  
  return diffReverse.reverse();
}

export function YamlCompareViewer({ versions, resourceName, onSelectVersion }: YamlCompareViewerProps) {
  const [leftVersionId, setLeftVersionId] = useState(versions[0]?.id || '');
  const [rightVersionId, setRightVersionId] = useState(versions[1]?.id || versions[0]?.id || '');
  
  const leftVersion = versions.find(v => v.id === leftVersionId);
  const rightVersion = versions.find(v => v.id === rightVersionId);
  
  const diffLines = useMemo(() => {
    if (!leftVersion || !rightVersion) return [];
    return computeDiff(leftVersion.yaml, rightVersion.yaml);
  }, [leftVersion, rightVersion]);
  
  const stats = useMemo(() => {
    return diffLines.reduce(
      (acc, line) => {
        if (line.type === 'added') acc.added++;
        else if (line.type === 'removed') acc.removed++;
        else acc.unchanged++;
        return acc;
      },
      { added: 0, removed: 0, unchanged: 0 }
    );
  }, [diffLines]);
  
  const handleSwap = () => {
    const temp = leftVersionId;
    setLeftVersionId(rightVersionId);
    setRightVersionId(temp);
  };
  
  const handleCopyDiff = () => {
    const diffText = diffLines.map(line => {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      const content = line.content.right || line.content.left || '';
      return `${prefix} ${content}`;
    }).join('\n');
    navigator.clipboard.writeText(diffText);
    toast.success('Diff copied to clipboard');
  };
  
  const handleDownloadDiff = () => {
    const diffText = diffLines.map(line => {
      const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
      const content = line.content.right || line.content.left || '';
      return `${prefix} ${content}`;
    }).join('\n');
    
    const blob = new Blob([diffText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${resourceName}-diff.patch`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Diff downloaded');
  };

  if (versions.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            YAML Comparison
          </CardTitle>
          <CardDescription>Compare different versions of the resource</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <GitCompare className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>At least two versions are required for comparison.</p>
            <p className="text-sm mt-1">Save a new version to enable comparison.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <GitCompare className="h-4 w-4" />
              YAML Comparison
            </CardTitle>
            <CardDescription>Compare different versions of the resource</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1 text-primary border-primary/30">
              <Plus className="h-3 w-3" />
              {stats.added}
            </Badge>
            <Badge variant="outline" className="gap-1 text-destructive border-destructive/30">
              <Minus className="h-3 w-3" />
              {stats.removed}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleCopyDiff} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              Copy Diff
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadDiff} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Version Selectors */}
        <div className="flex items-center gap-4 mb-4">
          <div className="flex-1">
            <Select value={leftVersionId} onValueChange={setLeftVersionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select left version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label} {v.timestamp && <span className="text-muted-foreground ml-2">({v.timestamp})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <Button variant="ghost" size="icon" onClick={handleSwap} className="shrink-0">
            <ChevronLeft className="h-4 w-4" />
            <ChevronRight className="h-4 w-4 -ml-2" />
          </Button>
          
          <div className="flex-1">
            <Select value={rightVersionId} onValueChange={setRightVersionId}>
              <SelectTrigger>
                <SelectValue placeholder="Select right version" />
              </SelectTrigger>
              <SelectContent>
                {versions.map(v => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.label} {v.timestamp && <span className="text-muted-foreground ml-2">({v.timestamp})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Side-by-side Editor View */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-2 px-1">{leftVersion?.label}</div>
            <CodeEditor
              value={leftVersion?.yaml || ''}
              readOnly
              minHeight="500px"
              className="rounded-lg"
            />
          </div>
          <div>
            <div className="text-sm font-medium mb-2 px-1">{rightVersion?.label}</div>
            <CodeEditor
              value={rightVersion?.yaml || ''}
              readOnly
              minHeight="500px"
              className="rounded-lg"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
