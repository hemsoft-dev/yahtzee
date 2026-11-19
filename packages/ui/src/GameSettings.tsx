import React, { useId, useRef, useState } from "react";
import { Icon } from "./Icons";

interface GameSettingsProps {
  diceCount: number;
  onDiceCountChange: (count: number) => void;
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  aiOpponents: number;
  onAiOpponentsChange: (count: number) => void;
  onStartGame: () => void;
  disabled?: boolean;
  offline?: boolean;
  recentNames?: string[];
}

const DICE_PRESETS = [
  { label: "Classic", value: 5 }, { label: "Extended", value: 6 },
  { label: "Mega", value: 8 }, { label: "Ultra", value: 10 },
];

export function GameSettings({ diceCount, onDiceCountChange, playerName, onPlayerNameChange, aiOpponents,
  onAiOpponentsChange, onStartGame, disabled, offline = false, recentNames = [] }: GameSettingsProps) {
  const nameId = useId();
  const nameErrorId = useId();
  const countId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const [nameMissing, setNameMissing] = useState(false);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (disabled) return;
    // Explain a missing name instead of leaving Start Game silently inert.
    if (!playerName.trim()) { setNameMissing(true); nameInput.current?.focus(); return; }
    onStartGame();
  }
  return <form className="game-settings" noValidate onSubmit={submit}>
    <div className="settings-heading"><h2>Make it your game.</h2><p>Pick your dice. Set your challenge.</p></div>
    <div className="settings-group">
      <label htmlFor={nameId}>Player name</label>
      <input ref={nameInput} id={nameId} autoComplete="nickname" type="text" placeholder="Enter your name" value={playerName}
        onChange={(event) => { setNameMissing(false); onPlayerNameChange(event.target.value); }} maxLength={20} disabled={disabled} required
        aria-invalid={nameMissing || undefined} aria-describedby={nameMissing ? nameErrorId : undefined} />
      {nameMissing && <p className="field-error" id={nameErrorId} role="alert">Enter a name to start.</p>}
      {recentNames.length > 0 && <div className="recent-names" aria-label="Recent players">
        {recentNames.map((name) => <button type="button" key={name} disabled={disabled} onClick={() => { setNameMissing(false); onPlayerNameChange(name); }}>{name}</button>)}
      </div>}
    </div>
    <fieldset className="settings-group" disabled={disabled}>
      <legend>Opponents</legend>
      <div className="segmented-control">{[0, 1, 2, 3].map((count) => <button type="button" key={count} aria-pressed={aiOpponents === count}
        onClick={() => onAiOpponentsChange(count)}>{count === 0 ? "Solo" : `${count} AI`}</button>)}</div>
    </fieldset>
    <fieldset className="settings-group" disabled={disabled}>
      <legend>Dice count</legend>
      <div className="dice-presets">{DICE_PRESETS.map(({ label, value }) => <button key={value} type="button" aria-label={`${label} (${value})`}
        aria-pressed={diceCount === value} onClick={() => onDiceCountChange(value)}><strong>{value}</strong><span>{label}</span></button>)}</div>
      <div className="custom-dice"><label htmlFor={countId}>Or choose your own</label><input id={countId} type="number" min={2} max={20} value={diceCount}
        onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 2 && value <= 20) onDiceCountChange(value); }} /><span>2–20 dice</span></div>
    </fieldset>
    <button className="button primary start-button" type="submit" disabled={disabled} aria-busy={disabled}>{disabled ? "Starting game..." : "Start Game"} <Icon name="arrow" /></button>
    <p className="setup-note">{offline ? "House rules. Fully offline. Scores saved on this PC." : "House rules. No account needed. Connection required."}</p>
  </form>;
}
