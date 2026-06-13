import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Tiny language-agnostic code tinter (Codex-style accents without the weight
 * of a real highlighter): comments / strings / keywords / numbers. Line-based
 * regexes — no catastrophic backtracking, good enough for a chat view.
 */
const KEYWORDS = new Set(
  (
    'const let var function return if else for while switch case break continue ' +
    'import from export default class extends new this async await try catch finally throw ' +
    'type interface enum implements public private readonly static void null undefined true false ' +
    'def lambda pass with as in is not and or elif print self None True False ' +
    'fn pub struct impl match use mod crate where loop unsafe trait'
  ).split(' ')
)

function tintLine(line: string, key: number): JSX.Element {
  // Whole-line comment?
  const cm = /^(\s*)(\/\/.*|#(?!!).*|\/\*.*|\*.*)$/.exec(line)
  if (cm) {
    return (
      <span key={key}>
        {cm[1]}
        <span className="tok-com">{cm[2]}</span>
        {'\n'}
      </span>
    )
  }
  // Tokenize strings / numbers / words; tint keywords and numbers.
  const parts: JSX.Element[] = []
  const re =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_][A-Za-z0-9_]*)\b/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={i++}>{line.slice(last, m.index)}</span>)
    if (m[1] !== undefined)
      parts.push(
        <span key={i++} className="tok-str">
          {m[1]}
        </span>
      )
    else if (m[2] !== undefined)
      parts.push(
        <span key={i++} className="tok-num">
          {m[2]}
        </span>
      )
    else if (KEYWORDS.has(m[3]))
      parts.push(
        <span key={i++} className="tok-kw">
          {m[3]}
        </span>
      )
    else parts.push(<span key={i++}>{m[3]}</span>)
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(<span key={i++}>{line.slice(last)}</span>)
  return (
    <span key={key}>
      {parts}
      {'\n'}
    </span>
  )
}

function CodeBlock({ lang, code }: { lang: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-codeblock">
      <div className="md-code-head">
        <span className="md-code-lang mono">{lang || 'code'}</span>
        <button
          className="md-code-copy mono"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            })
          }}
        >
          {copied ? '✓' : '⧉'}
        </button>
      </div>
      <pre className="md-code mono">
        {code
          .replace(/\n$/, '')
          .split('\n')
          .map((l, n) => tintLine(l, n))}
      </pre>
    </div>
  )
}

/**
 * Final-reply renderer (user feedback: raw markdown symbols read as gibberish).
 * GFM via react-markdown — no innerHTML, model output stays inert. Code blocks
 * get a header (language + copy) and the light tinter above; links open in the
 * system browser through a validated IPC.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props
            const inline = !/\blanguage-/.test(className ?? '') && !String(children).includes('\n')
            if (inline) return <code className="md-inline-code mono">{children}</code>
            const lang = /language-([\w-]+)/.exec(className ?? '')?.[1] ?? ''
            return <CodeBlock lang={lang} code={String(children)} />
          },
          // <pre> wrapping is handled inside CodeBlock.
          pre({ children }) {
            return <>{children}</>
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                title={href}
                onClick={(e) => {
                  e.preventDefault()
                  if (href) window.api.shell.openExternal(href)
                }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
