import { useState, useRef } from 'react'
import { importDelegationsJson, saveDelegation, type StoredDelegation } from '../lib/storage'

export default function ImportDelegation() {
  const [jsonInput, setJsonInput] = useState('')
  const [imported, setImported] = useState<StoredDelegation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function parseInput(text: string) {
    setError(null)
    setImported(null)
    setSaved(false)
    try {
      const delegations = importDelegationsJson(text)
      setImported(delegations)
    } catch (err: any) {
      setError(err.message || 'Failed to parse delegation JSON')
    }
  }

  function handlePaste() {
    parseInput(jsonInput)
  }

  function handleFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      setJsonInput(text)
      parseInput(text)
    }
    reader.readAsText(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleSave() {
    if (!imported) return
    imported.forEach(saveDelegation)
    setSaved(true)
  }

  return (
    <div className="space-y-6">
      <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02] space-y-4">
        <h2 className="text-lg font-semibold text-white">Import Delegation</h2>
        <p className="text-sm text-gray-400">
          Paste a delegation JSON or upload a file to import it.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? 'border-amber-500 bg-amber-500/5'
              : 'border-white/10 hover:border-white/20'
          }`}
        >
          <div className="text-3xl mb-2">📁</div>
          <p className="text-sm text-gray-400">
            Drop a JSON file here or <span className="text-amber-400">click to browse</span>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFile(file)
            }}
          />
        </div>

        {/* Text input */}
        <div>
          <label className="text-sm text-gray-400 block mb-1">Or paste JSON:</label>
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            rows={8}
            placeholder='{"delegation": {...}, "meta": {...}}'
            className="font-mono text-xs"
          />
          <button
            onClick={handlePaste}
            disabled={!jsonInput.trim()}
            className="mt-2 bg-white/10 hover:bg-white/15 disabled:opacity-30 text-white px-4 py-2 rounded-lg text-sm transition-colors"
          >
            Parse JSON
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Preview */}
        {imported && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white">
              Found {imported.length} delegation{imported.length !== 1 ? 's' : ''}
            </h3>
            {imported.map((d, i) => (
              <div key={i} className="bg-black/30 rounded-lg p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Delegate</span>
                  <span className="text-gray-300 font-mono">{d.delegation.delegate}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Label</span>
                  <span className="text-gray-300">{d.meta.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Status</span>
                  <span className="text-gray-300">{d.meta.status}</span>
                </div>
              </div>
            ))}

            {saved ? (
              <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-sm text-green-400">
                ✅ Saved to local storage
              </div>
            ) : (
              <button
                onClick={handleSave}
                className="bg-amber-500 hover:bg-amber-600 text-black font-semibold px-6 py-2 rounded-lg transition-colors text-sm"
              >
                Save to Local Storage
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
