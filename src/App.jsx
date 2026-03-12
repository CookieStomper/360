import { useState, useEffect, useCallback } from 'react'
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

  const [showSatellites, setShowSatellites] = useState(false)
  const [satelliteData, setSatelliteData] = useState(null)
  const [satelliteLoading, setSatelliteLoading] = useState(false)
  const [epochIndex, setEpochIndex] = useState(0)
  const [constellationFilter, setConstellationFilter] = useState(DEFAULT_CONSTELLATION_FILTER)
  const [isPlaying, setIsPlaying] = useState(false)
  const [trackMode, setTrackMode] = useState('all')

  const loadSatelliteData = useCallback(async () => {
    if (satelliteData) return
    setSatelliteLoading(true)
    try {
      const res = await fetch('/satellite_data.json')
      const data = await res.json()
      setSatelliteData(data)
      setEpochIndex(0)
    } catch (err) {
      console.error('Failed to load satellite data:', err)
    } finally {
      setSatelliteLoading(false)
    }
  }, [satelliteData])

  useEffect(() => {
    if (showSatellites && !satelliteData) {
      loadSatelliteData()
    }
  }, [showSatellites, satelliteData, loadSatelliteData])

  useEffect(() => {
    if (!isPlaying || !satelliteData) return
    const maxEpoch = satelliteData.epochs.length - 1
    const interval = setInterval(() => {
      setEpochIndex((prev) => {
        if (prev >= maxEpoch) {
          setIsPlaying(false)
          return maxEpoch
        }
        return prev + 1
      })
    }, 100)
    return () => clearInterval(interval)
  }, [isPlaying, satelliteData])

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

  const maxEpoch = satelliteData ? satelliteData.epochs.length - 1 : 0

  const availableConstellations = satelliteData
    ? [...new Set(Object.values(satelliteData.satellites).map((s) => s.constellation))]
    : []

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
              <h2 className="text-sm font-semibold text-gray-300 mb-2">Satellite Overlay</h2>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-gray-400">Show Satellites</label>
                <input
                  type="checkbox"
                  checked={showSatellites}
                  onChange={(e) => setShowSatellites(e.target.checked)}
                  className="w-4 h-4 text-violet-600 bg-gray-700 border-gray-600 rounded focus:ring-violet-500 focus:ring-2"
                />
              </div>

              {showSatellites && satelliteLoading && (
                <p className="text-xs text-gray-500">Loading satellite data...</p>
              )}

              {showSatellites && satelliteData && (
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
                        min={0}
                        max={maxEpoch}
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

      <div className="flex-1 w-full h-full">
        {imageUrl ? (
          <Viewer360
            imageUrl={imageUrl}
            showGrid={showGrid}
            gridInterval={gridInterval}
            satelliteData={showSatellites ? satelliteData : null}
            epochIndex={epochIndex}
            constellationFilter={constellationFilter}
            trackMode={trackMode}
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
