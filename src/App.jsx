import { useState } from 'react'
import Viewer360 from './components/Viewer360'

function App() {
  const [imageUrl, setImageUrl] = useState(null)
  const [showGrid, setShowGrid] = useState(false)
  const [gridInterval, setGridInterval] = useState(15)

  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
    }
  }

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col relative">
      <div className="absolute top-4 left-4 z-10 bg-black/50 p-4 rounded-lg backdrop-blur-sm w-64">
        <h1 className="text-white text-xl font-bold mb-4">360 Viewer</h1>

        {/* File Upload */}
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

        {/* Grid Settings */}
        {imageUrl && (
          <div className="border-t border-gray-700 pt-3">
            <h2 className="text-sm font-semibold text-gray-300 mb-2">Overlay Settings</h2>

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
        )}
      </div>

      <div className="flex-1 w-full h-full">
        {imageUrl ? (
          <Viewer360 imageUrl={imageUrl} showGrid={showGrid} gridInterval={gridInterval} />
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
