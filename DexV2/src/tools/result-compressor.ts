const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'for', 'with', 'in', 'on', 'at', 'by', 'from',
  'is', 'was', 'were', 'are', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'please',
  'dex', 'run', 'execute', 'i', 'you', 'he', 'she', 'they', 'we', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'their', 'our', 'it', 'this', 'that', 'these', 'those', 'which', 'who', 'whom'
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

export function outlineJson(val: any, depth = 0): string {
  if (depth > 4) return '"..."';
  if (val === null) return 'null';
  if (typeof val !== 'object') {
    if (typeof val === 'string') {
      if (val.length > 100) {
        return JSON.stringify(val.substring(0, 97) + '...');
      }
      return JSON.stringify(val);
    }
    return String(val);
  }
  
  const indent = '  '.repeat(depth);
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    const items = val.slice(0, 5).map(item => outlineJson(item, depth + 1));
    if (val.length > 5) {
      items.push(`"... (${val.length - 5} more items)"`);
    }
    return `[\n${items.map(x => indent + '  ' + x).join(',\n')}\n${indent}]`;
  }
  
  const keys = Object.keys(val);
  if (keys.length === 0) return '{}';
  
  const filteredKeys = keys.filter(k => !/screenshot|image|base64|dataUrl|coordinates/i.test(k));
  const lines = filteredKeys.map(k => {
    const v = val[k];
    return `"${k}": ${outlineJson(v, depth + 1)}`;
  });
  
  if (keys.length > filteredKeys.length) {
    lines.push(`"... (${keys.length - filteredKeys.length} heavy fields omitted)"`);
  }
  
  return `{\n${lines.map(x => indent + '  ' + x).join(',\n')}\n${indent}}`;
}

export function compressResult(output: string, toolName?: string, intent?: string): string {
  if (!output) {
    return output;
  }
  
  const trimmed = output.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return outlineJson(parsed);
    } catch (e) {
      // Not valid JSON, fall through
    }
  }
  
  if (output.length < 500) {
    return output;
  }
  
  const lines = output.split(/\r?\n/);
  if (lines.length <= 15) {
    return output;
  }
  
  if (toolName === 'exec') {
    const errorRegex = /\b(error|fail|exception|denied)\b/i;
    const errorLines: { line: string; idx: number }[] = [];
    const finalLines: { line: string; idx: number }[] = [];
    
    // Scan error lines
    for (let i = 0; i < lines.length; i++) {
      if (errorRegex.test(lines[i])) {
        errorLines.push({ line: lines[i], idx: i });
      }
    }
    
    // Find final 5 non-empty lines
    let count = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim()) {
        finalLines.unshift({ line: lines[i], idx: i });
        count++;
        if (count >= 5) break;
      }
    }
    
    const selectedErrors = errorLines.slice(0, 10);
    const addedIndices = new Set<number>();
    const merged: { line: string; idx: number }[] = [];
    
    for (const item of selectedErrors) {
      if (!addedIndices.has(item.idx)) {
        addedIndices.add(item.idx);
        merged.push(item);
      }
    }
    
    for (const item of finalLines) {
      if (!addedIndices.has(item.idx)) {
        addedIndices.add(item.idx);
        merged.push(item);
      }
    }
    
    // Sort merged items by their original line index to preserve sequence
    merged.sort((a, b) => a.idx - b.idx);
    
    return merged.map(x => x.line).join('\n') + 
      `\n\n... [Output truncated. Kept ${selectedErrors.length} error lines and ${finalLines.length} final lines] ...`;
  }
  
  if (intent) {
    const keywords = extractKeywords(intent);
    if (keywords.length > 0) {
      const scored = lines.map((line, idx) => {
        const lowerLine = line.toLowerCase();
        let matches = 0;
        for (const kw of keywords) {
          if (lowerLine.includes(kw)) {
            matches++;
          }
        }
        const score = matches / (line.split(/\s+/).length || 1);
        return { line, idx, score, matches };
      });
      
      const matching = scored.filter(x => x.matches > 0);
      if (matching.length > 0) {
        matching.sort((a, b) => b.score - a.score);
        const top8 = matching.slice(0, 8);
        top8.sort((a, b) => a.idx - b.idx);
        
        return `... [Output truncated. Showing top ${top8.length} matching lines based on intent] ...\n` + 
          top8.map(x => `[Line ${x.idx + 1}] ${x.line}`).join('\n') + 
          `\n... [Truncated] ...`;
      }
    }
  }
  
  // Default fallback
  const first5 = lines.slice(0, 5);
  const last5 = lines.slice(-5);
  return first5.join('\n') + '\n\n... [Output truncated] ...\n\n' + last5.join('\n');
}
