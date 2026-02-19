import { useState } from 'react'
import Viewer360 from './components/Viewer360'

function App() {
  const [imageUrl, setImageUrl] = useState(null)

  const handleFileChange = (event) => {
    const file = event.target.files[0]
    if (file) {
      const url = URL.createObjectURL(file)
      setImageUrl(url)
    }
  }

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col relative">
      <div className="absolute top-4 left-4 z-10 bg-black/50 p-4 rounded-lg backdrop-blur-sm">
        <h1 className="text-white text-xl font-bold mb-4">360 Viewer</h1>
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

      <div className="flex-1 w-full h-full">
        {imageUrl ? (
          <Viewer360 imageUrl={imageUrl} />
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
