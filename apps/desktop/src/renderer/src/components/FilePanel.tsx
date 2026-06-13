import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, FolderOpen } from 'lucide-react'
import type { DirEntry, FilePreview } from '../../../shared/ipc'

/** One expandable tree node; children load lazily on first expand. */
function TreeNode({
  entry,
  depth,
  filter,
  onOpen,
  selected,
}: {
  entry: DirEntry
  depth: number
  filter: string
  onOpen: (path: string) => void
  selected: string | null
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<DirEntry[] | null>(null)

  const toggle = useCallback(() => {
    if (!open && children === null) void window.api.fs.listDir(entry.path).then(setChildren)
    setOpen((v) => !v)
  }, [open, children, entry.path])

  const matches = !filter || entry.name.toLowerCase().includes(filter.toLowerCase())

  if (entry.isDir) {
    return (
      <>
        {matches && (
          <button className="file-node" style={{ paddingLeft: depth * 12 + 6 }} onClick={toggle}>
            <span className={open ? 'file-caret open' : 'file-caret'}>▸</span>
            <span className="file-icon">
              {open ? <FolderOpen size={13} /> : <Folder size={13} />}
            </span>
            <span className="file-name">{entry.name}</span>
          </button>
        )}
        {open &&
          children?.map((c) => (
            <TreeNode
              key={c.path}
              entry={c}
              depth={depth + 1}
              filter={filter}
              onOpen={onOpen}
              selected={selected}
            />
          ))}
      </>
    )
  }

  if (!matches) return <></>
  return (
    <button
      className={selected === entry.path ? 'file-node file-leaf active' : 'file-node file-leaf'}
      style={{ paddingLeft: depth * 12 + 6 }}
      onClick={() => onOpen(entry.path)}
    >
      <span className="file-icon">📄</span>
      <span className="file-name">{entry.name}</span>
    </button>
  )
}

/**
 * 文件 panel (user request, Reasonix-style): project directory tree with
 * lazy-loaded folders and an in-panel text/code preview. Read-only — it's for
 * looking, not editing (the agent edits; this is the human's window).
 */
export function FilePanel(): JSX.Element {
  const { t } = useTranslation()
  const [roots, setRoots] = useState<DirEntry[]>([])
  const [filter, setFilter] = useState('')
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.api.fs.listDir('').then(setRoots)
  }, [])

  const open = (path: string): void => {
    void window.api.fs.readFile(path).then(setPreview)
  }

  if (preview) {
    const name = preview.path.split('/').pop() ?? preview.path
    return (
      <div className="file-preview">
        <div className="file-preview-head">
          <button
            className="icon-btn tip"
            data-tip={t('files.back')}
            onClick={() => setPreview(null)}
          >
            ‹
          </button>
          <span className="file-preview-name mono" title={preview.path}>
            {name}
          </span>
          {preview.content && (
            <button
              className={copied ? 'icon-btn tip is-ok' : 'icon-btn tip'}
              data-tip={copied ? t('msg.copied') : t('msg.copy')}
              onClick={() => {
                void navigator.clipboard.writeText(preview.content).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                })
              }}
            >
              ⧉
            </button>
          )}
        </div>
        {preview.binary ? (
          <div className="panel-empty prose dim">{t('files.binary')}</div>
        ) : preview.tooLarge ? (
          <div className="panel-empty prose dim">{t('files.tooLarge')}</div>
        ) : (
          <pre className="file-code mono">
            {preview.content}
            {preview.truncated && `\n\n— ${t('files.truncated')} —`}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="file-tree">
      <input
        className="input file-filter"
        placeholder={t('files.filter')}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {roots.length === 0 && <div className="panel-empty prose dim">{t('files.empty')}</div>}
      {roots.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} filter={filter} onOpen={open} selected={null} />
      ))}
    </div>
  )
}
