import { useEffect, useState } from 'react'
import './App.css'

// TypeScript interfaces
interface AnimationEffect {
  name: string
  duration: string
  timing: string
  category?: string
}

interface EffectPreferences {
  version: number
  includedEffects: string[]
}

// All entrance animations from Animista.net
const ENTRANCE_EFFECTS: AnimationEffect[] = [
  // Bounce In
  { name: 'bounce-in-top', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-right', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-bottom', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-left', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-fwd', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-bck', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  
  // Fade In
  { name: 'fade-in', duration: '1.2s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-top', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-right', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-bottom', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-left', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-fwd', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-bck', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  
  // Flip In
  { name: 'flip-in-hor-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-in-hor-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-in-ver-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-in-ver-left', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  
  // Roll In
  { name: 'roll-in-left', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  { name: 'roll-in-right', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  { name: 'roll-in-top', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  { name: 'roll-in-bottom', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  
  // Rotate In
  { name: 'rotate-in-center', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-top', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-right', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-bottom', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-left', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-2-cw', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-2-ccw', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  
  // Scale In
  { name: 'scale-in-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-left', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-hor-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-ver-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  
  // Slide In
  { name: 'slide-in-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-left', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-fwd-center', duration: '0.4s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-bck-center', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-blurred-top', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'slide-in-blurred-right', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'slide-in-blurred-bottom', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'slide-in-blurred-left', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  
  // Swing In
  { name: 'swing-in-top-fwd', duration: '0.5s', timing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', category: 'Swing' },
  { name: 'swing-in-right-fwd', duration: '0.5s', timing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', category: 'Swing' },
  { name: 'swing-in-bottom-fwd', duration: '0.5s', timing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', category: 'Swing' },
  { name: 'swing-in-left-fwd', duration: '0.5s', timing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', category: 'Swing' },
  
  // Puff In
  { name: 'puff-in-center', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-top', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-right', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-bottom', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-left', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-hor', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-ver', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  
  // TEXT EFFECTS - Focus In
  { name: 'text-focus-in', duration: '1s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  
  // TEXT EFFECTS - Blur In
  { name: 'text-blur-out', duration: '1.2s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  
  // TEXT EFFECTS - Flicker In
  { name: 'text-flicker-in-glow', duration: '1.5s', timing: 'linear', category: 'Text' },
  
  // TEXT EFFECTS - Pop Up
  { name: 'text-pop-up-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Text' },
  { name: 'text-pop-up-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Text' },
  { name: 'text-pop-up-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Text' },
  { name: 'text-pop-up-left', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Text' },
  
  // TEXT EFFECTS - Shadow Pop
  { name: 'text-shadow-pop-top', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-tr', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-right', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-br', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-bottom', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-bl', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-left', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-pop-tl', duration: '0.6s', timing: 'ease', category: 'Text' },
  
  // TEXT EFFECTS - Shadow Drop
  { name: 'text-shadow-drop-center', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-top', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-tr', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-right', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-br', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-bottom', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-bl', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-left', duration: '0.6s', timing: 'ease', category: 'Text' },
  { name: 'text-shadow-drop-tl', duration: '0.6s', timing: 'ease', category: 'Text' },
  
  // TEXT EFFECTS - Tracking In
  { name: 'tracking-in-expand', duration: '0.7s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-contract', duration: '0.8s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-expand-fwd', duration: '0.8s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-contract-bck', duration: '1s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
]

// After Effects - Attention-grabbing animations from Animista.net
const AFTER_EFFECTS: AnimationEffect[] = [
  // Blink
  { name: 'blink-1', duration: '0.6s', timing: 'linear', category: 'Blink' },
  { name: 'blink-2', duration: '0.9s', timing: 'linear', category: 'Blink' },
  
  // Vibrate
  { name: 'vibrate-1', duration: '0.3s', timing: 'linear', category: 'Vibrate' },
  { name: 'vibrate-2', duration: '0.5s', timing: 'linear', category: 'Vibrate' },
  { name: 'vibrate-3', duration: '0.5s', timing: 'linear', category: 'Vibrate' },
  
  // Flicker
  { name: 'flicker-1', duration: '2s', timing: 'linear', category: 'Flicker' },
  { name: 'flicker-2', duration: '3s', timing: 'linear', category: 'Flicker' },
  { name: 'flicker-3', duration: '1.5s', timing: 'linear', category: 'Flicker' },
  
  // Shake
  { name: 'shake-horizontal', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'shake-vertical', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'shake-lr', duration: '0.6s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'shake-top', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'shake-bottom', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  
  // Jello
  { name: 'jello-horizontal', duration: '0.9s', timing: 'ease', category: 'Jello' },
  { name: 'jello-vertical', duration: '0.9s', timing: 'ease', category: 'Jello' },
  { name: 'jello-diagonal-1', duration: '0.8s', timing: 'ease', category: 'Jello' },
  { name: 'jello-diagonal-2', duration: '0.8s', timing: 'ease', category: 'Jello' },
  
  // Wobble
  { name: 'wobble-hor-bottom', duration: '0.8s', timing: 'ease', category: 'Wobble' },
  { name: 'wobble-hor-top', duration: '0.8s', timing: 'ease', category: 'Wobble' },
  { name: 'wobble-ver-left', duration: '0.8s', timing: 'ease', category: 'Wobble' },
  { name: 'wobble-ver-right', duration: '0.8s', timing: 'ease', category: 'Wobble' },
  
  // Bounce (attention-grabbing, different from bounce-in)
  { name: 'bounce-top', duration: '0.9s', timing: 'ease', category: 'Bounce Attention' },
  { name: 'bounce-bottom', duration: '0.9s', timing: 'ease', category: 'Bounce Attention' },
  { name: 'bounce-left', duration: '1.1s', timing: 'ease', category: 'Bounce Attention' },
  { name: 'bounce-right', duration: '1.1s', timing: 'ease', category: 'Bounce Attention' },
  
  // Pulsate
  { name: 'pulsate-fwd', duration: '0.5s', timing: 'ease-in-out', category: 'Pulsate' },
  { name: 'pulsate-bck', duration: '0.5s', timing: 'ease-in-out', category: 'Pulsate' },
]

// Combine all effects
const ALL_EFFECTS = [...ENTRANCE_EFFECTS, ...AFTER_EFFECTS]

// LocalStorage utilities
const STORAGE_KEY = 'existential-detective-effect-prefs'

function loadEffectPreferences(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const prefs: EffectPreferences = JSON.parse(stored)
      return new Set(prefs.includedEffects)
    }
  } catch (error) {
    console.warn('Failed to load effect preferences:', error)
  }
  // Default: all effects included
  return new Set(ALL_EFFECTS.map(e => e.name))
}

function saveEffectPreferences(includedEffects: Set<string>): void {
  try {
    const prefs: EffectPreferences = {
      version: 1,
      includedEffects: Array.from(includedEffects)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch (error) {
    console.warn('Failed to save effect preferences:', error)
  }
}

function App() {
  const [poemContent, setPoemContent] = useState<string>('')
  const [sentences, setSentences] = useState<string[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [effectIndex, setEffectIndex] = useState(0)
  const [key, setKey] = useState(0) // Force re-render to retrigger animation
  const [showAbout, setShowAbout] = useState(false)
  const [showEffectPicker, setShowEffectPicker] = useState(false)
  const [includedEffects, setIncludedEffects] = useState<Set<string>>(() => loadEffectPreferences())
  const [previewEffectName, setPreviewEffectName] = useState<string | null>(null)
  const [showMenuBar, setShowMenuBar] = useState(false)
  const [showSplash, setShowSplash] = useState(true)

  // Get active effects (only included ones)
  const activeEffects = ALL_EFFECTS.filter(effect => includedEffects.has(effect.name))

  // Splash screen timer - fade to main content after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 3000)
    
    return () => clearTimeout(timer)
  }, [])

  // Track mouse position to show/hide menu bar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setShowMenuBar(e.clientY < 200)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Load preferences from localStorage on mount
  useEffect(() => {
    const prefs = loadEffectPreferences()
    setIncludedEffects(prefs)
  }, [])

  useEffect(() => {
    // Fetch the poem content
    fetch('/poem.md')
      .then(response => response.text())
      .then(text => {
        setPoemContent(text)
        // Split by periods OR by lines (for poetry without periods)
        let splitSentences: string[]
        
        if (text.includes('.')) {
          // Has periods - split by sentences
          splitSentences = text
            .split('.')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => s + '.')
        } else {
          // No periods - split by lines (poetry format)
          splitSentences = text
            .split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0)
        }
        
        setSentences(splitSentences)
      })
      .catch(err => console.error('Error loading poem:', err))
  }, [])

  const handleNext = () => {
    const nextSentenceIndex = (currentIndex + 1) % sentences.length
    const nextEffectIndex = (effectIndex + 1) % activeEffects.length
    
    setCurrentIndex(nextSentenceIndex)
    setEffectIndex(nextEffectIndex)
    setKey(prev => prev + 1) // Force animation to retrigger
    setPreviewEffectName(null) // Clear any preview effect
  }

  const toggleCurrentEffect = () => {
    if (!currentEffect) return
    
    const newIncluded = new Set(includedEffects)
    if (newIncluded.has(currentEffect.name)) {
      // Prevent removing the last effect
      if (newIncluded.size <= 1) {
        alert('You must keep at least one effect included!')
        return
      }
      newIncluded.delete(currentEffect.name)
    } else {
      newIncluded.add(currentEffect.name)
    }
    setIncludedEffects(newIncluded)
    saveEffectPreferences(newIncluded)
  }

  const toggleEffect = (effectName: string) => {
    const newIncluded = new Set(includedEffects)
    if (newIncluded.has(effectName)) {
      // Prevent removing the last effect
      if (newIncluded.size <= 1) {
        alert('You must keep at least one effect included!')
        return
      }
      newIncluded.delete(effectName)
    } else {
      newIncluded.add(effectName)
    }
    setIncludedEffects(newIncluded)
    saveEffectPreferences(newIncluded)
  }

  const previewEffect = (effectName: string) => {
    setPreviewEffectName(effectName)
    setKey(prev => prev + 1) // Trigger animation
  }

  // Group effects by category
  const effectsByCategory = ALL_EFFECTS.reduce((acc, effect) => {
    const category = effect.category || 'Other'
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(effect)
    return acc
  }, {} as Record<string, AnimationEffect[]>)

  const categories = Object.keys(effectsByCategory).sort()

  // Use preview effect if set, otherwise use current effect from activeEffects
  const currentEffect = previewEffectName 
    ? ALL_EFFECTS.find(e => e.name === previewEffectName) || activeEffects[effectIndex] || activeEffects[0]
    : activeEffects[effectIndex] || activeEffects[0]
  const currentSentence = sentences[currentIndex]

  return (
    <div className="app-container">
      {/* Background Video */}
      <video 
        className="background-video"
        autoPlay 
        loop 
        muted 
        playsInline
      >
        <source src="/vids/waning_2160p30.mp4" type="video/mp4" />
      </video>

      {/* Overlay for dimming video */}
      <div className="video-overlay"></div>

      {/* Menu Bar */}
      <div className={`menu-bar ${showMenuBar ? 'visible' : ''}`}>
        <h1 className="menu-title" data-text="Existential Detective Agency">
          <span>Existential Detective Agency</span>
        </h1>
      </div>

      {/* Content */}
      <main className="content">
        {showSplash ? (
          /* Splash Screen - Just the title centered */
          <div className="splash-screen">
            <h1 className="title" data-text="Existential Detective Agency">
              <span>Existential Detective Agency</span>
            </h1>
          </div>
        ) : (
          /* Main Content - Fades in after splash */
          <div className={`poem-container ${!showSplash ? 'fade-in-content' : ''}`}>
            
            {activeEffects.length === 0 ? (
              <div className="no-effects-warning">
                <p className="warning-message">⚠ No effects selected!</p>
                <p className="warning-details">
                  You need at least one animation effect to display sentences.
                </p>
                <button 
                  className="next-button" 
                  onClick={() => setShowEffectPicker(true)}
                >
                  Open Effect Library
                </button>
              </div>
            ) : sentences.length > 0 && currentEffect ? (
              <>
                <div className="sentence-display">
                  <p key={key} className={`sentence ${currentEffect.name}`}>
                    {currentSentence}
                  </p>
                </div>

                <button className="next-button" onClick={handleNext}>
                  Next
                </button>
              </>
            ) : (
              <p className="placeholder">
                {poemContent ? 'Loading sentences...' : 'Add content to poem.md...'}
              </p>
            )}
          </div>
        )}
      </main>

      {/* Effect Info Bar */}
      {sentences.length > 0 && currentEffect && (
        <div className="effect-info-bar">
          <div className="effect-info">
            <span className="info-label">Effect:</span>
            <span className="info-value">{currentEffect.name}</span>
          </div>
          <div className="effect-info">
            <span className="info-label">Duration:</span>
            <span className="info-value">{currentEffect.duration}</span>
          </div>
          <div className="effect-info">
            <span className="info-label">Timing:</span>
            <span className="info-value">{currentEffect.timing}</span>
          </div>
          <div className="effect-info">
            <span className="info-label">Progress:</span>
            <span className="info-value">
              Sentence {currentIndex + 1}/{sentences.length} • 
              Effect {effectIndex + 1}/{activeEffects.length}
            </span>
          </div>
          <div className="effect-info">
            <button 
              className="toggle-effect-btn" 
              onClick={toggleCurrentEffect}
              title={includedEffects.has(currentEffect.name) ? "Exclude this effect" : "Include this effect"}
            >
              {includedEffects.has(currentEffect.name) ? '✓' : '✗'}
            </button>
          </div>
          <div className="effect-info">
            <button 
              className="settings-btn" 
              onClick={() => setShowEffectPicker(true)}
              title="Manage effect library"
            >
              ⚙
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="site-footer">
        <a 
          href="#about" 
          className="footer-link"
          onClick={(e) => {
            e.preventDefault()
            setShowAbout(true)
          }}
        >
          about
        </a>
        <span className="footer-separator">•</span>
        <a 
          href="https://svs.gsfc.nasa.gov/4655" 
          target="_blank" 
          rel="noopener noreferrer"
          className="footer-link"
          title="Moon visualization by NASA's Scientific Visualization Studio"
        >
          moon imagery: nasa svs
        </a>
      </footer>

      {/* About Modal */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAbout(false)}>×</button>
            <h2>About</h2>
            <div className="modal-body">
              <p className="pending-message">Content pending...</p>
            </div>
            <div className="modal-credits">
              <h3>Moon Visualization Credit</h3>
              <p>
                Please give credit for this item to:<br />
                <strong>NASA's Scientific Visualization Studio</strong>
              </p>
              <p>
                <strong>Visualizer</strong><br />
                Ernie Wright (USRA)
              </p>
              <p>
                <strong>Technical support</strong><br />
                Laurence Schuler (ADNET Systems, Inc.)<br />
                Ian Jones (ADNET Systems, Inc.)
              </p>
              <p>
                <strong>Editor</strong><br />
                Ernie Wright (USRA)
              </p>
              <p>
                <strong>Producer</strong><br />
                Wade Sisler (NASA/GSFC)
              </p>
              <p>
                <strong>Scientist</strong><br />
                Noah Petro (NASA/GSFC)
              </p>
              <p className="credit-link">
                <a 
                  href="https://svs.gsfc.nasa.gov/4655" 
                  target="_blank" 
                  rel="noopener noreferrer"
                >
                  View full visualization details at NASA SVS
                </a>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Effect Picker Modal */}
      {showEffectPicker && (
        <div className="modal-overlay" onClick={() => setShowEffectPicker(false)}>
          <div className="modal-content effect-picker-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowEffectPicker(false)}>×</button>
            <h2>Effect Library</h2>
            
            <div className="effect-summary">
              <p>{includedEffects.size} of {ALL_EFFECTS.length} effects included</p>
              <div className="bulk-actions">
                <button 
                  className="bulk-btn"
                  onClick={() => {
                    const allEffects = new Set(ALL_EFFECTS.map(e => e.name))
                    setIncludedEffects(allEffects)
                    saveEffectPreferences(allEffects)
                  }}
                >
                  Select All
                </button>
                <button 
                  className="bulk-btn"
                  onClick={() => {
                    if (confirm('This will deselect all but one effect. Continue?')) {
                      const firstEffect = new Set([ALL_EFFECTS[0].name])
                      setIncludedEffects(firstEffect)
                      saveEffectPreferences(firstEffect)
                    }
                  }}
                >
                  Deselect All
                </button>
                <button 
                  className="bulk-btn"
                  onClick={() => {
                    const allEffects = new Set(ALL_EFFECTS.map(e => e.name))
                    setIncludedEffects(allEffects)
                    saveEffectPreferences(allEffects)
                  }}
                >
                  Reset to Defaults
                </button>
              </div>
            </div>

            <div className="effect-categories">
              {categories.map(category => {
                const categoryEffects = effectsByCategory[category]
                const includedCount = categoryEffects.filter(e => includedEffects.has(e.name)).length
                
                return (
                  <details key={category} className="category-section" open>
                    <summary className="category-header">
                      <span className="category-name">{category}</span>
                      <span className="category-count">
                        {includedCount}/{categoryEffects.length}
                      </span>
                    </summary>
                    <div className="effect-list">
                      {categoryEffects.map(effect => (
                        <div key={effect.name} className="effect-row">
                          <label className="effect-label">
                            <input
                              type="checkbox"
                              checked={includedEffects.has(effect.name)}
                              onChange={() => toggleEffect(effect.name)}
                            />
                            <span className="effect-name">{effect.name}</span>
                          </label>
                          <button 
                            className="effect-demo-btn"
                            onClick={() => previewEffect(effect.name)}
                            title="Click to demo this effect on the main screen"
                          >
                            demo
                          </button>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
