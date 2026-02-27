import { Line, LineChart, ResponsiveContainer } from 'recharts'

interface SparklineProps {
  data: { timestamp: string; mean_spread: number }[]
  color: string
  height?: number
}

export default function Sparkline({ data, color, height = 32 }: SparklineProps) {
  if (data.length < 2) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="mean_spread"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
