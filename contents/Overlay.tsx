import { add, uniqBy } from "lodash"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react"

import Spaceship from "../components/Spaceship"
import client from "../core/store"

const Overlay = () => {
  const [active, setActive] = useState(true)
  const [players, setPlayers] = useState<any[]>([])
  const [settings, setSettings] = useState<any>()
  const [dead, setDead] = useState(false)
  const [channel, setChannel] = useState<any>()
  const [winnerTeam, setWinnerTeam] = useState<string>()
  const lastClicked = useRef<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>()
  const cursor = useRef<number[]>()

  useEffect(() => {
    console.log("Instance Ref: ", 5)
    chrome.runtime.onMessage.addListener((msgObj) => {
      setActive(msgObj.active)
      setDead(false)
      if (msgObj.active) {
        const settings = {
          key: msgObj.id,
          ship: msgObj.ship,
          team: msgObj.team
        }
        setSettings(settings)

        const channel = client.channel(window.location.href, {
          config: {
            presence: {
              key: settings.key
            },
            broadcast: {
              self: false
            }
          }
        })
        setChannel(channel)

        // Subscribe registers your client with the server
        channel.subscribe(async (status, err) => {
          if (status === "SUBSCRIBED") {
            console.log("Error, ", err)
            channel.track({
              team: settings.team,
              ship: settings.ship,
              key: settings.key,
              updated_at: Date.now()
            })

            window.ondrag = (ev: MouseEvent) => {
              ev.preventDefault()
            }

            window.onmousemove = (ev: MouseEvent) => {
              if (active) {
                const x = ev.pageX
                const y = ev.pageY

                channel.send({
                  type: "broadcast",
                  event: "cursor-pos",
                  payload: { id: settings.key, x, y }
                })
                setPlayers((players) =>
                  players.map((p) =>
                    p.key === settings.key
                      ? {
                          ...p,
                          mouseX: x,
                          mouseY: y
                        }
                      : p
                  )
                )
                cursor.current = [x, y]
              }
            }

            channel.on("broadcast", { event: "cursor-pos" }, (payload) => {
              setPlayers((players) => {
                return players.map((p) =>
                  p.key === payload.payload.id
                    ? {
                        ...p,
                        mouseX: payload.payload.x,
                        mouseY: payload.payload.y
                      }
                    : p
                )
              })
            })

            channel.on("broadcast", { event: "death" }, (payload) => {
              if (payload.payload.id === settings.key) {
                setDead(true)
                setActive(false)
              }
              setPlayers((players) => {
                return players.filter((p) => p.key !== payload.payload.id)
              })
            })

            channel.on("broadcast", { event: "laser" }, (payload) => {
              console.log(payload)
              console.log(payload.payload.id === settings.key)
              if (payload.payload.id === settings.key) return
              const canvas = canvasRef.current
              const ctx = canvas.getContext("2d")
              const rect = canvas.getBoundingClientRect()
              let x = payload.payload.x - rect.left
              let y = payload.payload.y - rect.top
              let width = 1
              const growTimer = setInterval(() => {
                if (width < 15) draw(ctx, x, y, width, payload.payload.team)
                width += 1.2
                if (width >= 45) {
                  clearInterval(growTimer)
                  if (
                    settings.team === "orange" ||
                    settings.team === "purple"
                  ) {
                    ctx.clearRect(x - 10, y + 20, 20, window.innerHeight)
                  } else {
                    ctx.clearRect(x - 10, 0, 20, y + 20)
                  }
                }
              }, 10)
            })

            channel.on("presence", { event: "sync" }, () => {
              // console.log(
              //   "Online users: ",
              //   JSON.stringify(channel.presenceState())
              // )
              const state = channel.presenceState()
              const addPlayers = new Map<string, any>()
              const presenceArray = Object.values(state).flat()
              presenceArray.forEach((presence) => {
                if (presence.updated_at)
                  if (
                    addPlayers.has(presence.key || presence.playerID) &&
                    !addPlayers.get(presence.key || presence.playerID)
                      .updated_at &&
                    addPlayers.get(presence.key || presence.playerID)
                      .updated_at < presence.updated_at
                  ) {
                    addPlayers.set(presence.key, presence)
                  } else if (
                    !addPlayers.has(presence.key || presence.playerID)
                  ) {
                    addPlayers.set(presence.key, presence)
                  }
              })
              setPlayers(Array.from(addPlayers.values()))
            })
          }
        })
      }
    })
  }, [])

  useLayoutEffect(() => {
    document.body.style.cursor = active ? "none" : "auto"
    document.body.style.userSelect = active ? "none" : "auto"
  }, [active])

  const draw = (ctx, x: number, y: number, width: number, team: string) => {
    ctx.beginPath()
    ctx.moveTo(x, team === "orange" || team === "purple" ? y + 20 : y + 20)
    ctx.lineTo(
      x,
      team === "orange" || team === "purple" ? window.innerHeight : 0
    )
    ctx.strokeStyle = getLaserColor(team)
    ctx.lineWidth = width
    ctx.stroke()
    ctx.closePath()
  }

  const killFirstInSight = useCallback(
    (x1, y1, width, height) => {
      let playerKilled
      const hitbox = 40
      for (const player of players.filter((p) => p.team !== settings.team)) {
        if (
          player.mouseX >= x1 - hitbox &&
          player.mouseX <= width + hitbox &&
          player.mouseY >= Math.min(y1, height) - hitbox &&
          player.mouseY <= Math.max(y1, height) + hitbox
        ) {
          playerKilled = player
          break
        }
      }
      if (playerKilled) {
        channel?.send({
          type: "broadcast",
          event: "death",
          payload: { id: playerKilled.key }
        })
      }
    },
    [settings, players, channel]
  )

  const keydown = useCallback(() => {
    if (active && Date.now() - lastClicked.current > 1200) {
      console.log("HIIII LASEEERR")
      lastClicked.current = Date.now()
      const canvas = canvasRef.current as HTMLCanvasElement
      const ctx = canvas.getContext("2d")
      const rect = canvas.getBoundingClientRect()
      let x = cursor.current[0] - rect.left
      let y = cursor.current[1] - rect.top
      let width = 1
      ;(async () => {
        channel?.send({
          type: "broadcast",
          event: "laser",
          payload: { id: settings.key, team: settings.team, x, y }
        })
      })()
      const growTimer = setInterval(() => {
        if (width < 15) draw(ctx, x, y, width, settings.team)
        width += 2
        if (width >= 45) {
          clearInterval(growTimer)
          if (settings.team === "orange" || settings.team === "purple") {
            killFirstInSight(x - 15, y + 20, x, window.innerHeight)
            ctx.clearRect(x - 10, y + 20, 20, window.innerHeight)
          } else {
            killFirstInSight(x - 15, 0, x, y + 20)
            ctx.clearRect(x - 10, 0, 20, y + 20)
          }
        }
      }, 10)
    }
  }, [settings, players, channel])

  useEffect(() => {
    calculateWinner()
  }, [players.length])

  useLayoutEffect(() => {
    window.onkeydown = (ev) => {
      if (ev?.which === 32) {
        ev.preventDefault()
        keydown()
      }
    }
  })

  const calculateWinner = useCallback(() => {
    let winnerTeam
    const teamMap = new Map<string, number>()
    for (const player of players) {
      if (teamMap.has(player.team))
        teamMap.set(player.team, teamMap.get(player.team) + 1)
      else teamMap.set(player.team, 1)
    }
    console.log(teamMap?.size)
    if (teamMap.size >= 0) {
      const sorted = Array.from(teamMap.keys()).sort(
        (team1, team2) => teamMap.get(team2) - teamMap.get(team1)
      )
      console.log(sorted)
      winnerTeam = sorted[0]
      setWinnerTeam(winnerTeam)
      console.log("Winner Team", winnerTeam)
    }
  }, [players])

  const getBGColor = useCallback((team) => {
    switch (team) {
      case "purple":
        return "#E97DB9"
      case "green":
        return "#C2E15F"
      case "orange":
        return "#FEB53A"
      case "blue":
        return "#2CE8F5"
      default:
        return "transparent"
    }
  }, [])

  const getLaserColor = useCallback((team) => {
    switch (team) {
      case "purple":
        return "#B55088"
      case "green":
        return "#637C20"
      case "orange":
        return "#E37100"
      case "blue":
        return "#0099DB"
      default:
        return "transparent"
    }
  }, [])

  return (
    <>
      {dead === true && <h1>YOU DIED!!1</h1>}
      {active && (
        <canvas
          id="battleCanvas"
          ref={canvasRef}
          onKeyDown={(ev) => console.log(ev.key)}
          height={window.innerHeight}
          width={window.innerWidth}
          style={{
            flex: 1,
            display: "block",
            opacity: 0.4,
            backgroundColor: getBGColor(winnerTeam),
            height: "100vh",
            width: "100vw",
            cursor: "none"
          }}
        />
      )}

      {players.map((x) => (
        <Spaceship
          key={x.key}
          ship={x.ship}
          position={{ mouseX: x.mouseX, mouseY: x.mouseY }}
          team={x.team}
        />
      ))}
    </>
  )
}

export default Overlay
