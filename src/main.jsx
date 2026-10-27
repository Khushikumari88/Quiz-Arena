import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { onValue, ref, get, set, update, remove, runTransaction } from 'firebase/database';
import { connectFirebase, hasFirebaseConfig } from './firebase';
import { QUESTIONS } from './questions';
import './styles.css';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newPlayerId = () => `p_${crypto.randomUUID ? crypto.randomUUID().replaceAll('-', '').slice(0, 16) : Math.random().toString(36).slice(2, 14)}`;
const makeCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const cleanName = (s) => s.trim().replace(/\s+/g, ' ').slice(0, 18);
const sortPlayers = (players = {}) => Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0) || a.name.localeCompare(b.name));
const prettyError = (e) => {
  if (e?.code === 'PERMISSION_DENIED' || e?.code === 'permission-denied') return 'Firebase denied this operation. Check Realtime Database rules for authenticated users.';
  if (e?.code === 'auth/operation-not-allowed') return 'Enable Anonymous sign-in in Firebase Console → Authentication → Sign-in method.';
  if (e?.code === 'auth/unauthorized-domain') return 'Add this website domain under Firebase Authentication → Settings → Authorized domains.';
  return e?.message || 'Something went wrong. Please try again.';
};

function App() {
  const [connection, setConnection] = useState({ ready: false, message: 'Connecting to Firebase…', error: '' });
  const [db, setDb] = useState(null);
  const [screen, setScreen] = useState('home');
  const [hostName, setHostName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [room, setRoom] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [busy, setBusy] = useState(false);
  const roomRef = useRef(null);
  const playerIdRef = useRef('');
  const revealingRef = useRef(false);
  const roomRefPath = useMemo(() => roomCode && db ? ref(db, `quizArena/rooms/${roomCode}`) : null, [db, roomCode]);
  const isHost = Boolean(room && playerId && room.hostId === playerId);
  const players = room?.players || {};
  const sortedPlayers = useMemo(() => sortPlayers(players), [players]);
  const question = room && room.questionIndex >= 0 ? QUESTIONS[room.questionIndex] : null;
  const myAnswer = room?.answers?.[room?.questionIndex]?.[playerId];

  useEffect(() => {
    let cancelled = false;
    connectFirebase().then(({ db: database }) => {
      if (cancelled) return;
      setDb(database);
      setConnection({ ready: true, message: 'Live multiplayer connected', error: '' });
    }).catch((e) => {
      if (cancelled) return;
      setConnection({ ready: false, message: 'Firebase connection needs attention', error: prettyError(e) });
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!roomRefPath) return undefined;
    const unsub = onValue(roomRefPath, (snap) => {
      if (!snap.exists()) {
        setRoom(null);
        setRoomCode('');
        setScreen('home');
        return;
      }
      const next = snap.val();
      setRoom(next);
      if (next.status === 'lobby') setScreen('lobby');
      else if (next.status === 'question') setScreen('game');
      else if (next.status === 'reveal') setScreen('reveal');
      else if (next.status === 'finished') setScreen('final');
      else if (next.status === 'closed') { setError('The host closed this room.'); setRoom(null); setRoomCode(''); setScreen('home'); }
    }, (e) => setError(prettyError(e)));
    return () => unsub();
  }, [roomRefPath]);

  useEffect(() => {
    if (screen !== 'game' || !room?.questionStartedAt) return undefined;
    const updateClock = () => {
      const remaining = Math.max(0, 15 - Math.floor((Date.now() - room.questionStartedAt) / 1000));
      setSecondsLeft(remaining);
    };
    updateClock();
    const id = setInterval(updateClock, 200);
    return () => clearInterval(id);
  }, [screen, room?.questionStartedAt, room?.questionIndex]);

  const revealQuestion = useCallback(async () => {
    if (!roomRef.current || revealingRef.current) return;
    revealingRef.current = true;
    try {
      await runTransaction(roomRef.current, (current) => {
        if (!current || current.status !== 'question') return;
        const q = QUESTIONS[current.questionIndex];
        if (!q) return;
        const answers = current.answers?.[current.questionIndex] || {};
        const roundScores = {};
        const nextPlayers = { ...(current.players || {}) };
        Object.values(nextPlayers).forEach((p) => {
          const correct = answers[p.id] === q.c;
          roundScores[p.id] = correct ? 100 : 0;
          nextPlayers[p.id] = { ...p, score: (p.score || 0) + roundScores[p.id], correct: (p.correct || 0) + (correct ? 1 : 0) };
        });
        return { ...current, players: nextPlayers, lastRoundScores: roundScores, status: 'reveal' };
      }, { applyLocally: false });
    } catch (e) { setError(prettyError(e)); }
    finally { revealingRef.current = false; }
  }, []);

  useEffect(() => {
    if (!isHost || screen !== 'game' || !room) return undefined;
    const count = Object.keys(room.players || {}).length;
    const answerCount = Object.keys(room.answers?.[room.questionIndex] || {}).length;
    if (count > 0 && answerCount >= count) revealQuestion();
    else if (secondsLeft <= 0) revealQuestion();
    return undefined;
  }, [isHost, screen, room, secondsLeft, revealQuestion]);

  useEffect(() => { roomRef.current = roomRefPath; }, [roomRefPath]);
  useEffect(() => { playerIdRef.current = playerId; }, [playerId]);

  const createRoom = async (event) => {
    event.preventDefault(); setError('');
    const name = cleanName(hostName);
    if (!name) return setError('Please enter a nickname first.');
    if (!connection.ready || !db) return setError('Firebase is not connected yet. Check the connection status below.');
    setBusy(true);
    try {
      let code = '';
      for (let i = 0; i < 8; i += 1) {
        const candidate = makeCode();
        const snap = await get(ref(db, `quizArena/rooms/${candidate}`));
        if (!snap.exists()) { code = candidate; break; }
      }
      if (!code) throw new Error('Could not generate a unique room code. Try again.');
      const id = newPlayerId();
      const initial = { status: 'lobby', hostId: id, questionIndex: 0, questionStartedAt: null, players: { [id]: { id, name, score: 0, correct: 0, joinedAt: Date.now() } }, answers: {}, lastRoundScores: {}, createdAt: Date.now() };
      await set(ref(db, `quizArena/rooms/${code}`), initial);
      setRoomCode(code); setPlayerId(id); setPlayerName(name); setRoom(initial); setScreen('lobby');
    } catch (e) { setError(prettyError(e)); }
    finally { setBusy(false); }
  };

  const joinRoom = async (event) => {
    event.preventDefault(); setError('');
    const name = cleanName(joinName); const code = joinCode.trim().toUpperCase();
    if (!name) return setError('Please enter a nickname first.');
    if (code.length < 4 || code.length > 6) return setError('Room codes must be 4–6 characters.');
    if (!connection.ready || !db) return setError('Firebase is not connected yet. Check the connection status below.');
    setBusy(true);
    try {
      const target = ref(db, `quizArena/rooms/${code}`); const snap = await get(target);
      if (!snap.exists()) throw new Error('Room not found. Check the code and try again.');
      const existing = snap.val();
      if (existing.status !== 'lobby') throw new Error('This quiz has already started.');
      if (Object.keys(existing.players || {}).length >= 8) throw new Error('This room is full (8 players maximum).');
      if (Object.values(existing.players || {}).some((p) => p.name.toLowerCase() === name.toLowerCase())) throw new Error('That nickname is already taken in this room.');
      const id = newPlayerId();
      await set(ref(db, `quizArena/rooms/${code}/players/${id}`), { id, name, score: 0, correct: 0, joinedAt: Date.now() });
      setRoomCode(code); setPlayerId(id); setPlayerName(name); setRoom(existing); setScreen('lobby');
    } catch (e) { setError(prettyError(e)); }
    finally { setBusy(false); }
  };

  const startGame = async () => {
    if (!isHost || Object.keys(players).length < 2 || !roomRef.current) return;
    setError('');
    try { await update(roomRef.current, { status: 'question', questionIndex: 0, questionStartedAt: Date.now(), answers: {}, lastRoundScores: {} }); }
    catch (e) { setError(prettyError(e)); }
  };

  const submitAnswer = async (index) => {
    if (!roomRef.current || !room || room.status !== 'question' || myAnswer !== undefined) return;
    setError('');
    try {
      const answerRef = ref(db, `quizArena/rooms/${roomCode}/answers/${room.questionIndex}/${playerId}`);
      await runTransaction(answerRef, (current) => current === null ? index : current, { applyLocally: false });
    } catch (e) { setError(prettyError(e)); }
  };

  const nextQuestion = async () => {
    if (!isHost || !roomRef.current || room?.status !== 'reveal') return;
    try {
      if (room.questionIndex >= QUESTIONS.length - 1) await update(roomRef.current, { status: 'finished' });
      else await update(roomRef.current, { status: 'question', questionIndex: room.questionIndex + 1, questionStartedAt: Date.now() });
    } catch (e) { setError(prettyError(e)); }
  };

  const rematch = async () => {
    if (!roomRef.current || !isHost) return;
    const resetPlayers = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { ...p, score: 0, correct: 0 }]));
    try { await update(roomRef.current, { status: 'lobby', questionIndex: 0, questionStartedAt: null, answers: {}, lastRoundScores: {}, players: resetPlayers }); }
    catch (e) { setError(prettyError(e)); }
  };

  const leaveRoom = async () => {
    const code = roomCode; const id = playerId; const wasHost = isHost; const database = db;
    setRoom(null); setRoomCode(''); setPlayerId(''); setPlayerName(''); setScreen('home'); setError('');
    if (!database || !code || !id) return;
    try {
      const target = ref(database, `quizArena/rooms/${code}`);
      if (wasHost) await remove(target);
      else await remove(ref(database, `quizArena/rooms/${code}/players/${id}`));
    } catch { /* The local UI still exits even if cleanup is denied. */ }
  };

  const copyRoomCode = async () => {
    try { await navigator.clipboard.writeText(roomCode); setError('Room code copied!'); }
    catch { setError(`Share this room code: ${roomCode}`); }
  };

  const goHome = () => { setRoom(null); setRoomCode(''); setPlayerId(''); setScreen('home'); setError(''); };

  return <div className="app-shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <header className="topbar"><a className="brand" href="#home" onClick={(e) => { e.preventDefault(); if (screen === 'home') return; goHome(); }}><span className="brand-mark">Q</span><span>QUIZ<span className="brand-light">ARENA</span></span></a><div className="top-pills"><span className="pill"><i className={connection.ready ? 'status-dot' : 'status-dot offline'}/>{connection.ready ? 'LIVE SYSTEM' : 'CONNECTING'}</span><span className="pill desktop-only">2–8 PLAYERS · 10 ROUNDS</span></div></header>

    {screen === 'home' && <main className="home-view">
      <section className="hero"><div className="eyebrow"><span className="eyebrow-line"/> THE FRIENDS-ONLY BATTLEFIELD</div><h1>Think fast.<br/><span>Own the arena.</span></h1><p>Ten questions. Fifteen seconds each. Bring your friends, trust your instincts, and climb to the top of the leaderboard.</p><div className="hero-metrics"><div><strong>10</strong><span>Questions</span></div><div><strong>15<span className="metric-unit">s</span></strong><span>Per round</span></div><div><strong>+100</strong><span>Correct answer</span></div></div><div className="hero-orb" aria-hidden="true"><div className="orb-ring ring-a"/><div className="orb-ring ring-b"/><div className="orb-core">Q<span>!</span></div><span className="float-chip chip-a">⚡ QUICK THINKING</span><span className="float-chip chip-b">✦ REAL-TIME</span><span className="float-chip chip-c">+100 XP</span></div></section>
      <section className="entry-grid"><form className="entry-card create-card" onSubmit={createRoom}><div className="card-icon purple">↗</div><div className="card-kicker">HOST A GAME</div><h2>Build your arena</h2><p>Start a room and invite up to seven challengers.</p><label htmlFor="hostName">YOUR NICKNAME</label><input id="hostName" value={hostName} onChange={(e) => setHostName(e.target.value)} maxLength={18} placeholder="e.g. QuizMaster" autoComplete="nickname"/><button className="btn btn-primary" disabled={busy || !connection.ready}>{busy ? 'Creating room…' : 'Create a room'} <span>↗</span></button></form>
      <form className="entry-card join-card" onSubmit={joinRoom}><div className="card-icon cyan">⌁</div><div className="card-kicker">JOIN THE BATTLE</div><h2>Enter the arena</h2><p>Got a code? Jump into your friends' room.</p><label htmlFor="joinName">YOUR NICKNAME</label><input id="joinName" value={joinName} onChange={(e) => setJoinName(e.target.value)} maxLength={18} placeholder="e.g. Alex" autoComplete="nickname"/><label htmlFor="joinCode" className="code-label">ROOM CODE</label><input id="joinCode" className="room-code-input" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} maxLength={6} placeholder="ABCDE" autoComplete="off"/><button className="btn btn-secondary" disabled={busy || !connection.ready}>Join room <span>→</span></button></form></section>
      <section className="connection-row"><span className={`connection-icon ${connection.ready ? 'online' : 'offline'}`}>{connection.ready ? '✓' : '!'}</span><div><strong>{connection.ready ? 'You’re connected to the arena' : connection.message}</strong><p>{connection.ready ? 'Firebase real-time sync is ready. Your friends can join from their own devices.' : (connection.error || (hasFirebaseConfig() ? 'Connecting to Firebase…' : 'Set your Firebase values in the .env file to enable multiplayer.'))}</p></div><span className="connection-label">{connection.ready ? 'ONLINE' : 'SETUP'}</span></section>
      <footer className="footer"><span>QUIZ ARENA © 2026</span><span>BUILT FOR FRIENDLY COMPETITION</span></footer>
    </main>}

    {screen === 'lobby' && room && <main className="room-view"><div className="room-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> WAITING ROOM</div><h1>Gather your squad.</h1><p>Once everyone's in, the battle begins.</p></div><button className="btn btn-quiet" onClick={leaveRoom}>← Leave room</button></div><section className="room-code-card"><div><span className="card-kicker">YOUR ROOM CODE</span><div className="big-code">{roomCode}</div><p>Share this code with your friends to invite them.</p></div><button className="btn btn-secondary copy-btn" onClick={copyRoomCode}>▣ Copy code</button></section><section className="lobby-panel"><div className="section-heading"><div><span className="card-kicker">THE LINEUP</span><h2>Players <span className="count-badge">{Object.keys(players).length}/8</span></h2></div><span className="live-label"><i className="status-dot"/> LIVE SYNC</span></div><div className="player-grid">{sortedPlayers.map((p, i) => <div className={`player-tile ${p.id === playerId ? 'is-me' : ''}`} key={p.id}><div className={`avatar avatar-${i % 6}`}>{p.name.slice(0, 1).toUpperCase()}</div><div className="player-info"><strong>{p.name}{p.id === playerId ? ' (you)' : ''}</strong><span>{p.id === room.hostId ? '👑 HOST' : 'READY TO PLAY'}</span></div><span className="ready-check">✓</span></div>)}{Array.from({ length: Math.max(0, 2 - Object.keys(players).length) }, (_, i) => <div className="player-tile empty-slot" key={`empty-${i}`}><div className="avatar empty-avatar">+</div><div className="player-info"><strong>Waiting for player</strong><span>INVITE A FRIEND</span></div></div>)}</div><div className="lobby-bottom"><div className="rules-summary"><div><strong>10</strong><span>Questions</span></div><div><strong>15<span>s</span></strong><span>Timer</span></div><div><strong>100</strong><span>Points</span></div></div><div className="start-area">{isHost ? <button className="btn btn-primary start-btn" disabled={Object.keys(players).length < 2} onClick={startGame}>Start the quiz <span>↗</span></button> : <div className="waiting-host"><span className="pulse-dot"/> Waiting for the host to start…</div>}<small>{isHost ? (Object.keys(players).length < 2 ? 'At least 2 players are needed to start.' : 'Everyone’s here? Let’s do this.') : 'You’ll jump in automatically when the host starts.'}</small></div></div></section></main>}

    {screen === 'game' && room && question && <main className="game-view"><div className="game-topline"><div><div className="eyebrow"><span className="eyebrow-line"/> ROUND IN PROGRESS</div><h1>Make it count.</h1></div><button className="btn btn-quiet" onClick={leaveRoom}>Leave game</button></div><section className="question-panel"><div className="question-meta"><div className="round-counter"><span>ROUND</span><strong>{String(room.questionIndex + 1).padStart(2, '0')}<em> / 10</em></strong></div><div className="progress-track">{QUESTIONS.map((_, i) => <span key={i} className={i < room.questionIndex ? 'done' : i === room.questionIndex ? 'current' : ''}/>)}</div><div className={`timer-ring ${secondsLeft <= 5 ? 'urgent' : ''}`}><strong>{secondsLeft}</strong><span>SEC</span></div></div><div className="question-body"><span className="question-tag">GENERAL KNOWLEDGE <span>✦</span></span><h2>{question.q}</h2><p>Choose the best answer before the clock runs out.</p><div className="answer-grid">{question.a.map((answer, i) => <button key={answer} className={`answer-option ${myAnswer === i ? 'selected' : ''}`} disabled={myAnswer !== undefined || secondsLeft === 0} onClick={() => submitAnswer(i)}><span className="answer-letter">{'ABCD'[i]}</span><span>{answer}</span><span className="answer-arrow">↗</span></button>)}</div><div className="answer-foot"><span>{myAnswer !== undefined ? '✓ Answer locked in — good luck!' : secondsLeft === 0 ? 'Time is up. Waiting for results…' : 'Your answer stays private until the round ends.'}</span><span>{Object.keys(room.answers?.[room.questionIndex] || {}).length}/{Object.keys(players).length} ANSWERED</span></div></div></section><aside className="game-tip"><span>✦</span><p><strong>Scoring:</strong> +100 points for a correct answer. No speed bonus — accuracy is everything.</p></aside></main>}

    {screen === 'reveal' && room && question && <main className="results-view"><div className="eyebrow"><span className="eyebrow-line"/> ROUND {room.questionIndex + 1} RESULTS</div><div className="results-heading"><div><h1>{room.questionIndex === 9 ? 'Final round.' : 'Here’s the answer.'}</h1><p>{question.q}</p></div><div className="answer-stamp">✓ <span>CORRECT ANSWER</span><strong>{question.a[question.c]}</strong></div></div><section className="results-panel"><div className="section-heading"><div><span className="card-kicker">SCOREBOARD</span><h2>Leaderboard</h2></div><span className="score-note">+100 for correct · 0 otherwise</span></div><div className="table-wrap"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>ROUND PTS</th><th>TOTAL</th></tr></thead><tbody>{sortedPlayers.map((p, i) => <tr key={p.id} className={p.id === playerId ? 'my-row' : ''}><td><span className={`rank-chip rank-${i + 1}`}>{String(i + 1).padStart(2, '0')}</span></td><td><strong>{p.name}{p.id === playerId ? ' (you)' : ''}</strong></td><td>{room.lastRoundScores?.[p.id] || 0}</td><td><strong>{p.score || 0}</strong></td></tr>)}</tbody></table></div><div className="results-actions">{isHost ? <button className="btn btn-primary" onClick={nextQuestion}>{room.questionIndex === 9 ? 'View final rankings' : 'Next question'} <span>↗</span></button> : <div className="waiting-host"><span className="pulse-dot"/> Waiting for the host to continue…</div>}<span>Question {room.questionIndex + 1} of 10</span></div></section></main>}

    {screen === 'final' && room && <main className="results-view final-view"><div className="winner-hero"><div className="trophy">♛</div><div className="eyebrow"><span className="eyebrow-line"/> ARENA COMPLETE</div><h1>{sortedPlayers.length > 1 && sortedPlayers[0]?.score === sortedPlayers[1]?.score ? 'What a battle!' : 'We have a champion.'}</h1><p>{sortedPlayers.length > 1 && sortedPlayers[0]?.score === sortedPlayers[1]?.score ? `It’s a tie between ${sortedPlayers.filter(p => p.score === sortedPlayers[0].score).map(p => p.name).join(', ')}!` : `${sortedPlayers[0]?.name || 'The winner'} takes the crown with ${sortedPlayers[0]?.score || 0} points.`}</p></div><section className="results-panel"><div className="section-heading"><div><span className="card-kicker">FINAL STANDINGS</span><h2>Leaderboard</h2></div><span className="score-note">10 rounds completed</span></div><div className="table-wrap"><table><thead><tr><th>RANK</th><th>PLAYER</th><th>CORRECT</th><th>TOTAL</th></tr></thead><tbody>{sortedPlayers.map((p, i) => <tr key={p.id} className={p.id === playerId ? 'my-row' : ''}><td><span className={`rank-chip rank-${i + 1}`}>{String(i + 1).padStart(2, '0')}</span></td><td><strong>{p.name}{p.id === playerId ? ' (you)' : ''}</strong></td><td>{p.correct || 0}/10</td><td><strong>{p.score || 0}</strong></td></tr>)}</tbody></table></div><div className="results-actions">{isHost && <button className="btn btn-primary" onClick={rematch}>Play again <span>↻</span></button>}<button className="btn btn-quiet" onClick={leaveRoom}>Exit room</button></div></section></main>}

    {error && <div className={`toast ${error.includes('copied') ? 'success-toast' : ''}`} role="status"><span>{error.includes('copied') ? '✓' : '!'}</span><p>{error}</p><button onClick={() => setError('')} aria-label="Dismiss message">×</button></div>}
    <div className="background-grid" aria-hidden="true"/>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
