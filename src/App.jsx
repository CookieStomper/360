import { useState, useEffect, useCallback, useMemo } from 'react'
import Viewer360 from './components/Viewer360'

const DEFAULT_CONSTELLATION_FILTER = {
  GPS: true,
  Galileo: true,
  GLONASS: true,
  BeiDou: true,
}

const CONSTELLATION_COLORS = {
  GPS: '#1e90ff',
  Galileo: '#ff8c00',
  GLONASS: '#ff3333',
  BeiDou: '#32cd32',
}

function computeDOP(satellites) {
  if (satellites.length < 4) return null
  const n = satellites.length
  const H = satellites.map((s) => {
    const elRad = (s.el * Math.PI) / 180
    const azRad = (s.az * Math.PI) / 180
    return [
      Math.cos(elRad) * Math.sin(azRad),
      Math.cos(elRad) * Math.cos(azRad),
      Math.sin(elRad),
      1,
    ]
  })

  const HtH = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => {
      let sum = 0
      for (let k = 0; k < n; k++) sum += H[k][i] * H[k][j]
      return sum
    })
  )

  const m = HtH.map((r) => [...r])
  const inv = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => (i === j ? 1 : 0))
  )
  for (let col = 0; col < 4; col++) {
    let maxRow = col
    for (let row = col + 1; row < 4; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[maxRow][col])) maxRow = row
    }
    ;[m[col], m[maxRow]] = [m[maxRow], m[col]]
    ;[inv[col], inv[maxRow]] = [inv[maxRow], inv[col]]
    const diag = m[col][col]
    if (Math.abs(diag) < 1e-12) return null
    for (let j = 0; j < 4; j++) { m[col][j] /= diag; inv[col][j] /= diag }
    for (let row = 0; row < 4; row++) {
      if (row === col) continue
      const factor = m[row][col]
      for (let j = 0; j < 4; j++) { m[row][j] -= factor * m[col][j]; inv[row][j] -= factor * inv[col][j] }
    }
  }

  const pdop = Math.sqrt(inv[0][0] + inv[1][1] + inv[2][2])
  const hdop = Math.sqrt(inv[0][0] + inv[1][1])
  const vdop = Math.sqrt(inv[2][2])
  const gdop = Math.sqrt(inv[0][0] + inv[1][1] + inv[2][2] + inv[3][3])
  return { pdop, hdop, vdop, gdop }
}

function formatEpochTime(epochMs) {
  if (!epochMs) return ''
  const gpsEpoch = Date.UTC(1980, 0, 6)
  const date = new Date(gpsEpoch + epochMs)
  return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [showGrid, setShowGrid] = useState(false)
  const [gridInterval, setGridInterval] = useState(15)

  const [navFile, setNavFile] = useState(null)
  const [obsFile, setObsFile] = useState(null)
  const [satelliteData, setSatelliteData] = useState(null)
  const [satelliteLoading, setSatelliteLoading] = useState(false)
  const [satelliteError, setSatelliteError] = useState(null)
  const [epochIndex, setEpochIndex] = useState(0)
  const [constellationFilter, setConstellationFilter] = useState(DEFAULT_CONSTELLATION_FILTER)
  const [isPlaying, setIsPlaying] = useState(false)
  const [trackMode, setTrackMode] = useState('all')
  const [lookAtTarget, setLookAtTarget] = useState(null)

  const processRinexFiles = useCallback(async () => {
    if (!navFile || !obsFile) return
    setSatelliteLoading(true)
    setSatelliteError(null)
    try {
      const formData = new FormData()
      formData.append('nav', navFile)
      formData.append('obs', obsFile)
      const res = await fetch('/api/process', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Processing failed')
      setSatelliteData(data)
      setEpochIndex(data.obsRange?.startIndex ?? 0)
    } catch (err) {
      console.error('Failed to process RINEX files:', err)
      setSatelliteError(err.message)
    } finally {
      setSatelliteLoading(false)
    }
  }, [navFile, obsFile])

  const obsStartIdx = satelliteData?.obsRange?.startIndex ?? 0
  const obsEndIdx = satelliteData?.obsRange?.endIndex ?? (satelliteData ? satelliteData.epochs.length - 1 : 0)

  useEffect(() => {
    if (!isPlaying || !satelliteData) return
    const interval = setInterval(() => {
      setEpochIndex((prev) => {
        if (prev >= obsEndIdx) {
          setIsPlaying(false)
          return obsEndIdx
        }
        return prev + 1
      })
    }, 100)
    return () => clearInterval(interval)
  }, [isPlaying, satelliteData, obsEndIdx])

  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
    }
  }

  const toggleConstellation = (name) => {
    setConstellationFilter((prev) => ({ ...prev, [name]: !prev[name] }))
  }

  const availableConstellations = satelliteData
    ? [...new Set(Object.values(satelliteData.satellites).map((s) => s.constellation))]
    : []

  const visibleSatellites = useMemo(() => {
    if (!satelliteData) return []
    const result = []
    for (const [svId, sv] of Object.entries(satelliteData.satellites)) {
      if (!constellationFilter[sv.constellation]) continue

      let elAz = null
      if (sv.track) {
        let best = null, bestDist = Infinity
        for (const point of sv.track) {
          const d = Math.abs(point[0] - epochIndex)
          if (d < bestDist) { bestDist = d; best = point }
        }
        if (best && bestDist <= 1 && best[1] > 0) {
          elAz = { el: best[1], az: best[2] }
        }
      }

      let snr = null
      let isTracked = false
      if (sv.observed) {
        let best = null, bestDist = Infinity
        for (const point of sv.observed) {
          const d = Math.abs(point[0] - epochIndex)
          if (d < bestDist) { bestDist = d; best = point }
        }
        if (best && bestDist <= 1) {
          isTracked = true
          snr = best[1]
        }
      }

      if (!elAz) continue
      result.push({
        svId,
        constellation: sv.constellation,
        el: elAz.el,
        az: elAz.az,
        snr,
        isTracked,
      })
    }
    result.sort((a, b) => b.el - a.el)
    return result
  }, [satelliteData, epochIndex, constellationFilter])

  const trackedSatellites = useMemo(
    () => visibleSatellites.filter((s) => s.isTracked).sort((a, b) => (b.snr ?? 0) - (a.snr ?? 0)),
    [visibleSatellites]
  )

  const dop = useMemo(() => computeDOP(trackedSatellites), [trackedSatellites])

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col relative">
      <div className="absolute top-4 left-4 z-10 bg-black/50 p-4 rounded-lg backdrop-blur-sm w-72 max-h-[90vh] overflow-y-auto">
        <h1 className="text-white text-xl font-bold mb-4">360 Viewer</h1>

        <div className="mb-4">
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-400
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-violet-50 text-violet-700
              hover:file:bg-violet-100
            "
          />
          {imageUrl && (
            <button
              onClick={() => setImageUrl(null)}
              className="mt-2 text-xs text-red-500 hover:text-red-400 underline"
            >
              Clear Image
            </button>
          )}
        </div>

        {imageUrl && (
          <>
            <div className="border-t border-gray-700 pt-3 mb-3">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">Grid Overlay</h2>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">Show Grid</label>
                <input
                  type="checkbox"
                  checked={showGrid}
                  onChange={(e) => setShowGrid(e.target.checked)}
                  className="w-4 h-4 text-violet-600 bg-gray-700 border-gray-600 rounded focus:ring-violet-500 focus:ring-2"
                />
              </div>
              {showGrid && (
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-400">Interval</label>
                  <select
                    value={gridInterval}
                    onChange={(e) => setGridInterval(Number(e.target.value))}
                    className="bg-gray-700 text-white text-sm rounded-lg focus:ring-violet-500 focus:border-violet-500 block p-1.5"
                  >
                    <option value={5}>5°</option>
                    <option value={10}>10°</option>
                    <option value={15}>15°</option>
                    <option value={20}>20°</option>
                    <option value={30}>30°</option>
                    <option value={45}>45°</option>
                  </select>
                </div>
              )}
            </div>

            <div className="border-t border-gray-700 pt-3">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">GNSS Data</h2>
              <div className="mb-2">
                <label className="text-xs text-gray-500 block mb-1">Navigation file (.rnx)</label>
                <input
                  type="file"
                  accept=".rnx,.nav,.n,.21n,.22n,.23n,.24n,.25n"
                  onChange={(e) => { setNavFile(e.target.files[0]); setSatelliteData(null) }}
                  className="block w-full text-xs text-gray-400
                    file:mr-2 file:py-1 file:px-3
                    file:rounded file:border-0
                    file:text-xs file:font-medium
                    file:bg-gray-700 file:text-gray-300
                    hover:file:bg-gray-600"
                />
              </div>
              <div className="mb-2">
                <label className="text-xs text-gray-500 block mb-1">Observation file (.rnx)</label>
                <input
                  type="file"
                  accept=".rnx,.obs,.o,.21o,.22o,.23o,.24o,.25o"
                  onChange={(e) => { setObsFile(e.target.files[0]); setSatelliteData(null) }}
                  className="block w-full text-xs text-gray-400
                    file:mr-2 file:py-1 file:px-3
                    file:rounded file:border-0
                    file:text-xs file:font-medium
                    file:bg-gray-700 file:text-gray-300
                    hover:file:bg-gray-600"
                />
              </div>
              <button
                onClick={processRinexFiles}
                disabled={!navFile || !obsFile || satelliteLoading}
                className="w-full py-1.5 rounded text-sm font-medium transition-all mb-2 disabled:opacity-30 disabled:cursor-not-allowed bg-violet-600 hover:bg-violet-500 text-white"
              >
                {satelliteLoading ? 'Processing...' : 'Process GNSS Data'}
              </button>
              {satelliteError && (
                <p className="text-xs text-red-400 mb-2">{satelliteError}</p>
              )}
              {satelliteData && !satelliteLoading && (
                <div className="mb-3 p-2 bg-gray-800/60 rounded text-xs">
                  <p className="text-green-400 font-medium mb-2">Data loaded</p>
                  <div className="text-gray-400 space-y-0.5">
                    {satelliteData.observation?.marker && (
                      <p><span className="text-gray-500">Site:</span> {satelliteData.observation.marker}</p>
                    )}
                    {satelliteData.observation?.receiver && (
                      <p><span className="text-gray-500">Receiver:</span> {satelliteData.observation.receiver}</p>
                    )}
                    {satelliteData.observation?.antenna && (
                      <p><span className="text-gray-500">Antenna:</span> {satelliteData.observation.antenna}</p>
                    )}
                    <p><span className="text-gray-500">Period:</span> {satelliteData.observation?.obsStart?.slice(11)} – {satelliteData.observation?.obsEnd?.slice(11)}</p>
                    <p><span className="text-gray-500">Date:</span> {satelliteData.observation?.obsStart?.slice(0, 10)}</p>
                    <p><span className="text-gray-500">Duration:</span> {satelliteData.observation?.duration}</p>
                    {satelliteData.observation?.interval && (
                      <p><span className="text-gray-500">Interval:</span> {satelliteData.observation.interval}s</p>
                    )}
                    <p><span className="text-gray-500">Satellites:</span> {satelliteData.observation?.totalSatellites} ({satelliteData.observation?.constellations?.join(', ')})</p>
                  </div>
                </div>
              )}

              {satelliteData && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm text-gray-400">Tracks</label>
                    <div className="flex gap-1">
                      {['all', 'active'].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setTrackMode(mode)}
                          className={`text-xs px-2 py-1 rounded transition-all ${
                            trackMode === mode
                              ? 'bg-violet-600 text-white'
                              : 'bg-gray-700 text-gray-400 hover:text-white'
                          }`}
                        >
                          {mode === 'all' ? 'All' : 'Active'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-3">
                    <div className="flex flex-wrap gap-2 mb-2">
                      {availableConstellations.map((name) => (
                        <button
                          key={name}
                          onClick={() => toggleConstellation(name)}
                          className="text-xs px-2 py-1 rounded-full border transition-all"
                          style={{
                            borderColor: CONSTELLATION_COLORS[name] || '#888',
                            backgroundColor: constellationFilter[name]
                              ? CONSTELLATION_COLORS[name] + '33'
                              : 'transparent',
                            color: constellationFilter[name]
                              ? CONSTELLATION_COLORS[name]
                              : '#666',
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="text-white text-sm bg-violet-600 hover:bg-violet-500 rounded px-2 py-0.5"
                      >
                        {isPlaying ? '||' : '\u25B6'}
                      </button>
                      <input
                        type="range"
                        min={obsStartIdx}
                        max={obsEndIdx}
                        value={epochIndex}
                        onChange={(e) => {
                          setEpochIndex(Number(e.target.value))
                          setIsPlaying(false)
                        }}
                        className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                      />
                    </div>
                    <p className="text-xs text-gray-500 text-center">
                      {formatEpochTime(satelliteData.epochs[epochIndex])}
                    </p>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {satelliteData && trackedSatellites.length > 0 && (
        <div className="absolute top-4 right-4 z-10 bg-black/50 p-4 rounded-lg backdrop-blur-sm w-64 max-h-[90vh] overflow-y-auto">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">
            Tracked Satellites
          </h2>
          <p className="text-[10px] text-gray-500 mb-2">
            {trackedSatellites.length} tracked
          </p>
          {dop && (
            <div className="grid grid-cols-4 gap-1 mb-3 text-center">
              {[
                ['PDOP', dop.pdop],
                ['HDOP', dop.hdop],
                ['VDOP', dop.vdop],
                ['GDOP', dop.gdop],
              ].map(([label, value]) => (
                <div key={label} className="bg-gray-800/60 rounded px-1 py-1.5">
                  <div className="text-[10px] text-gray-500">{label}</div>
                  <div className={`text-sm font-mono font-semibold ${
                    value < 2 ? 'text-green-400' : value < 5 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {value.toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!dop && (
            <p className="text-xs text-gray-500 mb-3">Need 4+ tracked satellites for DOP</p>
          )}
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-700">
                <th className="text-left py-1 font-medium">SV</th>
                <th className="text-right py-1 font-medium">El°</th>
                <th className="text-right py-1 font-medium">Az°</th>
                <th className="text-right py-1 font-medium">SNR</th>
              </tr>
            </thead>
            <tbody>
              {trackedSatellites.map((sat) => (
                <tr
                  key={sat.svId}
                  className="border-b border-gray-800 cursor-pointer hover:bg-white/5 transition-colors"
                  style={{ color: CONSTELLATION_COLORS[sat.constellation] || '#fff' }}
                  onClick={() => setLookAtTarget({ el: sat.el, az: sat.az, _t: Date.now() })}
                >
                  <td className="py-1 font-mono">{sat.svId}</td>
                  <td className="py-1 text-right font-mono">{sat.el.toFixed(1)}</td>
                  <td className="py-1 text-right font-mono">{sat.az.toFixed(1)}</td>
                  <td className="py-1 text-right font-mono">
                    <span className={
                      sat.snr >= 40 ? 'text-green-400' :
                      sat.snr >= 25 ? 'text-yellow-400' : 'text-red-400'
                    }>
                      {sat.snr != null ? sat.snr.toFixed(0) : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex-1 w-full h-full">
        {imageUrl ? (
          <Viewer360
            imageUrl={imageUrl}
            showGrid={showGrid}
            gridInterval={gridInterval}
            satelliteData={satelliteData}
            epochIndex={epochIndex}
            constellationFilter={constellationFilter}
            trackMode={trackMode}
            lookAtTarget={lookAtTarget}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <p className="text-2xl mb-2">Upload a 360° Image</p>
              <p className="text-sm">Drag and drop or use the file picker</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
