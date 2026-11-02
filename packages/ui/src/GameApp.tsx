import React, { useState } from "react";
import { PipFace } from "./DiceRow";
import { GameSettings } from "./GameSettings";
import { GamePlay } from "./GamePlay";
import { GameResults, type HighScore, type HistoryEntry } from "./GameResults";
import { ThemeToggle } from "./ThemeToggle";
import { ThemeProvider, darkTheme, lightTheme } from "./theme";
import { Icon } from "./Icons";
import type { useGameSession } from "./useGameSession";
import "./game.css";

type Session = ReturnType<typeof useGameSession>;
interface GameAppProps {
  desktop?: boolean;
  offline?: boolean;
  session: Session;
  diceCount: number;
  onDiceCountChange: (count: number) => void;
  highScores: HighScore[] | undefined;
  history: HistoryEntry[] | undefined;
}

function readNames(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem("yahtzee-recent-names") ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0).slice(0, 5) : [];
  } catch { return []; }
}
function readAppearance(): "light" | "dark" {
  try { return localStorage.getItem("yahtzee-theme") === "dark" ? "dark" : "light"; } catch { return "light"; }
}
function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Play remains available when local preferences cannot be saved. */ }
}

function AppHeader({ game, playing, onQuit, onToggle }: { game: Session["game"]; playing: boolean; onQuit: () => void; onToggle: () => void }) {
  const context = game ? `${game.diceCount} dice · ${game.players.length === 1 ? "Solo game" : `${game.players.length} players`}` : "A little luck. A little strategy.";
  return <header className="app-header">
    <div className="brand"><span className="brand-mark"><Icon name="dice" size={26} /></span><h1>third roll<span>.</span></h1></div>
    <div className="header-context">{context}</div>
    <div className="header-actions">
      {playing && <button type="button" className="button quiet quit-button" onClick={onQuit}><Icon name="close" size={16} /> Quit Game</button>}
      <ThemeToggle onToggle={onToggle} />
    </div>
  </header>;
}

function ConnectionStatus({ session, offline }: { session: Session; offline: boolean }) {
  return <>
    {session.error && <div className="connection-error" role="alert"><p>{session.error}</p>{session.canRetry && <button type="button" className="button secondary" onClick={session.retry} disabled={session.busy}>Retry move</button>}</div>}
    <div className="sr-only" role="status">{session.busy ? session.game ? "Saving move..." : offline ? "Starting offline game..." : "Starting guest game..." : ""}</div>
  </>;
}

function WelcomeDeck() {
  return <section className="welcome-deck">
    <h2>Good things<br />come to<br /><span>those who roll.</span></h2>
    <div className="welcome-dice" aria-hidden="true">{[5, 3, 6].map((value) => <div className="display-die" key={value}><PipFace value={value} /></div>)}</div>
    <div className="welcome-bottom"><p>Keep the good ones.<br />Make the next roll count.</p><span className="welcome-rule">Up to 3 rolls. One choice.</span></div>
  </section>;
}

function AppFooter({ offline, playing }: { offline: boolean; playing: boolean }) {
  const message = offline ? "Offline edition · Scores stay on this PC"
    : playing ? "Guest game · Keep this window open to continue" : "Roll. Hold. Make your move.";
  return <footer className="app-footer"><span>Third Roll, your way.</span><span>{message}</span></footer>;
}

export function GameApp({ desktop = false, offline = false, session, diceCount, onDiceCountChange, highScores, history }: GameAppProps) {
  const [recentNames, setRecentNames] = useState(readNames);
  const [playerName, setPlayerName] = useState(() => readNames()[0] ?? "");
  const [aiOpponents, setAiOpponents] = useState(0);
  const [appearance, setAppearance] = useState(readAppearance);
  const [rollKey, setRollKey] = useState(0);
  const [rolling, setRolling] = useState(false);
  const { game, busy, start, reset, roll } = session;
  const screen = !game ? "setup" : game.status === "finished" ? "finished" : "playing";

  async function startGame() {
    const name = playerName.trim();
    if (await start({ name, diceCount, aiOpponents })) {
      const names = [name, ...recentNames.filter((entry) => entry !== name)].slice(0, 5);
      setRecentNames(names); savePreference("yahtzee-recent-names", JSON.stringify(names));
      setRollKey(0); setRolling(false);
    }
  }
  function requestRoll() { setRollKey((key) => key + 1); setRolling(true); roll(); }
  function quitGame() { reset(); setRolling(false); }
  function toggleAppearance() {
    const next = appearance === "dark" ? "light" : "dark";
    setAppearance(next); savePreference("yahtzee-theme", next);
  }

  return <ThemeProvider value={appearance === "dark" ? darkTheme : lightTheme}>
    <main className={`game-app ${desktop ? "desktop-app" : "web-app"} screen-${screen}`} data-theme={appearance}
      data-testid={desktop ? "desktop-app-shell" : "web-app-shell"}>
      <div className="app-frame">
        <AppHeader game={game} playing={screen === "playing"} onQuit={quitGame} onToggle={toggleAppearance} />
        <ConnectionStatus session={session} offline={offline} />
        {screen === "setup" && <div className="setup-layout">
          <WelcomeDeck />
          <GameSettings diceCount={diceCount} onDiceCountChange={onDiceCountChange} playerName={playerName} onPlayerNameChange={setPlayerName}
            aiOpponents={aiOpponents} onAiOpponentsChange={setAiOpponents} onStartGame={() => { void startGame(); }} disabled={busy} recentNames={recentNames} offline={offline} />
        </div>}
        {screen === "playing" && game && <GamePlay session={session} game={game} desktop={desktop} leaderboardScores={(highScores ?? []).map((entry) => entry.score)}
          rolling={rolling} rollKey={rollKey} onRoll={requestRoll} onRollSettled={() => setRolling(false)} />}
        {screen === "finished" && game && <GameResults game={game} history={history} highScores={highScores} onPlayAgain={quitGame} offline={offline} />}
        <AppFooter offline={offline} playing={screen === "playing"} />
      </div>
    </main>
  </ThemeProvider>;
}
