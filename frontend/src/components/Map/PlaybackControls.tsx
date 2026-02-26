import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  leadHour: number
  setLeadHour: (h: number | ((prev: number) => number)) => void
  min?: number
  max?: number
  step?: number
}

const SPEEDS = [
  { label: '1x', ms: 2000 },
  { label: '2x', ms: 1000 },
  { label: '4x', ms: 500 },
]

export default function PlaybackControls({
  leadHour,
  setLeadHour,
  min = 0,
  max = 120,
  step = 6,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const advance = useCallback(() => {
    setLeadHour(prev => {
      const next = prev + step
      return next > max ? min : next
    })
  }, [setLeadHour, min, max, step])

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(advance, SPEEDS[speedIdx].ms)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [playing, speedIdx, advance])

  const progress = max === min ? 0 : ((leadHour - min) / (max - min)) * 100

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => setPlaying(p => !p)}
        className="flex items-center justify-center w-8 h-8 rounded bg-gray-700 hover:bg-gray-600 text-sm"
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        )}
      </button>

      <button
        onClick={() => setSpeedIdx(i => (i + 1) % SPEEDS.length)}
        className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 min-w-[32px]"
        title="Playback speed"
      >
        {SPEEDS[speedIdx].label}
      </button>

      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden min-w-[80px]">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
