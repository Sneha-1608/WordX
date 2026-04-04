interface CodeBlockProps {
  code: string;
  className?: string;
}

export function CodeBlock({ code, className = '' }: CodeBlockProps) {
  // Simple syntax highlighting
  const highlightCode = (raw: string) => {
    return raw.split('\n').map((line, i) => {
      let highlighted = line
        // Comments (// and -- and #)
        .replace(/(\/\/.*$|--.*$)/gm, '<span style="color:rgba(255,255,255,0.35)">$1</span>')
        // Strings (single and double quoted, and template literals)
        .replace(/(['"`])((?:(?!\1).)*?)\1/g, '<span style="color:#10B981">$1$2$1</span>')
        // Keywords
        .replace(
          /\b(const|let|var|function|return|await|async|if|else|new|import|from|export|interface|type|INSERT|INTO|VALUES|SELECT|FROM|WHERE)\b/g,
          '<span style="color:#C084FC">$1</span>'
        )
        // Numbers
        .replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#FCD34D">$1</span>')
        // Types after colon
        .replace(/:\s*(string|number|boolean|any)/g, ': <span style="color:#60A5FA">$1</span>');

      return (
        <div key={i} style={{ minHeight: '1.8em' }}>
          <span dangerouslySetInnerHTML={{ __html: highlighted || '&nbsp;' }} />
        </div>
      );
    });
  };

  return (
    <div
      className={`rounded-[24px] bg-brand-indigo overflow-hidden ${className}`}
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      {/* macOS Traffic Lights */}
      <div className="flex items-center gap-2 px-6 pt-5 pb-3">
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FF5F57' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#FFBD2E' }} />
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#28CA42' }} />
      </div>

      {/* Code Content */}
      <div className="px-7 pb-6 overflow-x-auto">
        <pre
          className="text-code-md"
          style={{
            color: 'rgba(255,255,255,0.85)',
            lineHeight: '200%',
            tabSize: 2,
          }}
        >
          <code>{highlightCode(code)}</code>
        </pre>
      </div>
    </div>
  );
}
