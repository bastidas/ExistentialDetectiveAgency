import { MouseEvent, useEffect, useState } from 'react'
import './App.css'

// Timing constants for auto-play
const SENTENCE_DURATION = 3; // seconds to hold each sentence
const SENTENCE_DURATION_VAR = 1.5; // seconds of random variance
const INTRO_DURATION = 3 // seconds for intro splash screen

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

// Selected effects subset - 46 effects chosen for artistic poem presentation
const SELECTED_EFFECTS: AnimationEffect[] = [
  // Intro Effects - Entrance animations
  { name: 'fade-in-bottom', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-in-bck', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'flip-in-hor-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-in-ver-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-in-hor-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'roll-in-right', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  { name: 'rotate-in-2-ccw', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-in-top', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'scale-in-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-hor-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-in-ver-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'slide-in-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-in-blurred-top', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'slide-in-blurred-right', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'slide-in-blurred-bottom', duration: '0.6s', timing: 'cubic-bezier(0.23, 1, 0.32, 1)', category: 'Slide' },
  { name: 'swing-in-left-fwd', duration: '0.5s', timing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)', category: 'Swing' },
  { name: 'puff-in-center', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-top', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-bottom', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-hor', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'puff-in-ver', duration: '0.7s', timing: 'cubic-bezier(0.47, 0, 0.745, 0.715)', category: 'Puff' },
  { name: 'bounce-in-fwd', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-in-bck', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'text-focus-in', duration: '1s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'text-flicker-in-glow', duration: '1.5s', timing: 'linear', category: 'Text' },
  { name: 'tracking-in-contract', duration: '0.8s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-expand', duration: '0.7s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-expand-fwd', duration: '0.8s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  { name: 'tracking-in-contract-bck', duration: '1s', timing: 'cubic-bezier(0.215, 0.61, 0.355, 1)', category: 'Text' },
  
  // Ambient Effects - Can be used for intro or outro
  { name: 'blink-1', duration: '0.6s', timing: 'linear', category: 'Blink' },
  { name: 'blink-2', duration: '0.9s', timing: 'linear', category: 'Blink' },
  { name: 'flicker-3', duration: '1.5s', timing: 'linear', category: 'Flicker' },
  { name: 'flicker-2', duration: '3s', timing: 'linear', category: 'Flicker' },
  { name: 'jello-horizontal', duration: '0.9s', timing: 'ease', category: 'Jello' },
  { name: 'pulsate-fwd', duration: '0.5s', timing: 'ease-in-out', category: 'Pulsate' },
  { name: 'pulsate-bck', duration: '0.5s', timing: 'ease-in-out', category: 'Pulsate' },
  { name: 'bounce-top', duration: '0.9s', timing: 'ease', category: 'Bounce Attention' },
  { name: 'bounce-right', duration: '1.1s', timing: 'ease', category: 'Bounce Attention' },
  { name: 'shake-horizontal', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'shake-vertical', duration: '0.8s', timing: 'cubic-bezier(0.455, 0.030, 0.515, 0.955)', category: 'Shake' },
  { name: 'vibrate-1', duration: '0.3s', timing: 'linear', category: 'Vibrate' },
  { name: 'vibrate-3', duration: '0.5s', timing: 'linear', category: 'Vibrate' },
  { name: 'vibrate-2', duration: '0.5s', timing: 'linear', category: 'Vibrate' },
  
  // Outro Effect - Exit animation
  { name: 'text-blur-out', duration: '1.2s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
]

// Outro effects - reverse animations for exits
const OUTRO_EFFECTS: AnimationEffect[] = [
  { name: 'fade-out-bottom', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'fade-out-bck', duration: '0.6s', timing: 'cubic-bezier(0.39, 0.575, 0.565, 1)', category: 'Fade' },
  { name: 'flip-out-hor-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-out-ver-right', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'flip-out-hor-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Flip' },
  { name: 'roll-out-right', duration: '0.6s', timing: 'ease-out', category: 'Roll' },
  { name: 'rotate-out-2-cw', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'rotate-out-top', duration: '0.6s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Rotate' },
  { name: 'scale-out-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-out-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-out-hor-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'scale-out-ver-center', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Scale' },
  { name: 'slide-out-top', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-out-bottom', duration: '0.5s', timing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', category: 'Slide' },
  { name: 'slide-out-blurred-top', duration: '0.6s', timing: 'cubic-bezier(0.755, 0.05, 0.855, 0.06)', category: 'Slide' },
  { name: 'slide-out-blurred-right', duration: '0.6s', timing: 'cubic-bezier(0.755, 0.05, 0.855, 0.06)', category: 'Slide' },
  { name: 'slide-out-blurred-bottom', duration: '0.6s', timing: 'cubic-bezier(0.755, 0.05, 0.855, 0.06)', category: 'Slide' },
  { name: 'swing-out-left-fwd', duration: '0.5s', timing: 'cubic-bezier(0.6, -0.28, 0.735, 0.045)', category: 'Swing' },
  { name: 'puff-out-center', duration: '0.7s', timing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', category: 'Puff' },
  { name: 'puff-out-top', duration: '0.7s', timing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', category: 'Puff' },
  { name: 'puff-out-bottom', duration: '0.7s', timing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', category: 'Puff' },
  { name: 'puff-out-hor', duration: '0.7s', timing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', category: 'Puff' },
  { name: 'puff-out-ver', duration: '0.7s', timing: 'cubic-bezier(0.165, 0.84, 0.44, 1)', category: 'Puff' },
  { name: 'bounce-out-fwd', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'bounce-out-bck', duration: '1.1s', timing: 'ease', category: 'Bounce' },
  { name: 'text-blur-out', duration: '1.2s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'text-focus-out', duration: '1s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'tracking-out-expand', duration: '0.7s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'tracking-out-contract', duration: '0.8s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'tracking-out-expand-fwd', duration: '0.8s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
  { name: 'tracking-out-contract-bck', duration: '1s', timing: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)', category: 'Text' },
]

// Categorize effects for auto-play
// Intro effects: clear entrance animations
const INTRO_EFFECT_NAMES = [
  'fade-in-bottom', 'fade-in-bck', 'flip-in-hor-top', 'flip-in-ver-right', 
  'flip-in-hor-bottom', 'roll-in-right', 'rotate-in-2-ccw', 'rotate-in-top',
  'scale-in-center', 'scale-in-bottom', 'scale-in-hor-center', 'scale-in-ver-center',
  'slide-in-top', 'slide-in-bottom', 'slide-in-blurred-top', 'slide-in-blurred-right',
  'slide-in-blurred-bottom', 'swing-in-left-fwd', 'puff-in-center', 'puff-in-top',
  'puff-in-bottom', 'puff-in-hor', 'puff-in-ver', 'bounce-in-fwd', 'bounce-in-bck',
  'text-focus-in', 'text-flicker-in-glow', 'tracking-in-contract', 'tracking-in-expand',
  'tracking-in-expand-fwd', 'tracking-in-contract-bck'
]

// Ambient effects: can work for intro or outro
const AMBIENT_EFFECT_NAMES = [
  'blink-1', 'blink-2', 'flicker-3', 'flicker-2', 'jello-horizontal',
  'pulsate-fwd', 'pulsate-bck', 'bounce-top', 'bounce-right',
  'shake-horizontal', 'shake-vertical', 'vibrate-1', 'vibrate-3', 'vibrate-2'
]

// Combine all effects (keep for effect library compatibility)
const ALL_EFFECTS = [...SELECTED_EFFECTS, ...OUTRO_EFFECTS]

// LocalStorage utilities
const STORAGE_KEY = 'existential-detective-effect-prefs'

function loadEffectPreferences(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const prefs: EffectPreferences = JSON.parse(stored)
      // Filter preferences to only include effects that exist in ALL_EFFECTS
      const validEffects = prefs.includedEffects.filter(name => 
        ALL_EFFECTS.some(e => e.name === name)
      )
      return new Set(validEffects.length > 0 ? validEffects : ALL_EFFECTS.map(e => e.name))
    }
  } catch (error) {
    console.warn('Failed to load effect preferences:', error)
  }
  // Default: all SELECTED_EFFECTS and OUTRO_EFFECTS included
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
  const [showPoemExperience, setShowPoemExperience] = useState(false)
  const envVars = import.meta.env as Record<string, string | boolean | undefined>
  const rawDebugFlag = envVars.VITE_DEBUG ?? envVars.DEBUG ?? false
  const isDebugMode = String(rawDebugFlag).toLowerCase() === 'true'
  
  // Auto-play state
  const [currentPhase, setCurrentPhase] = useState<'intro' | 'outro' | 'stopped'>('stopped')
  const [currentIntroEffect, setCurrentIntroEffect] = useState<AnimationEffect | null>(null)
  const [currentOutroEffect, setCurrentOutroEffect] = useState<AnimationEffect | null>(null)

  // Get active effects (only included ones)
  const activeEffects = ALL_EFFECTS.filter(effect => includedEffects.has(effect.name))
  
  // Get effect arrays for random selection
  const introEffects = SELECTED_EFFECTS.filter(e => INTRO_EFFECT_NAMES.includes(e.name) && includedEffects.has(e.name))
  const ambientEffects = SELECTED_EFFECTS.filter(e => AMBIENT_EFFECT_NAMES.includes(e.name) && includedEffects.has(e.name))
  const outroEffects = [...OUTRO_EFFECTS.filter(e => includedEffects.has(e.name)), ...ambientEffects]
  const allIntroOptions = [...introEffects, ...ambientEffects]

  // Splash screen timer - fade to main content after INTRO_DURATION
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, INTRO_DURATION * 1000)
    
    return () => clearTimeout(timer)
  }, [])

  // Track mouse position to show/hide menu bar
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setShowMenuBar(!showSplash && e.clientY < 200)
    }
    
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [showSplash])

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
        // Always respect the original line breaks from the source poem
        const splitSentences = text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0)

        setSentences(splitSentences)
      })
      .catch(err => console.error('Error loading poem:', err))
  }, [])

  // Auto-play effect - manages intro and outro phases
  useEffect(() => {
    // Don't start until splash is done, the landing is cleared, and we have sentences
    if (showSplash || !showPoemExperience || sentences.length === 0) return
    
    // Start first line if we're in stopped state
    if (currentPhase === 'stopped' && currentIndex === 0) {
      // Select random intro effect
      const introOptions = allIntroOptions.length > 0 ? allIntroOptions : SELECTED_EFFECTS.filter(e => INTRO_EFFECT_NAMES.includes(e.name))
      const randomIntro = introOptions[Math.floor(Math.random() * introOptions.length)]
      setCurrentIntroEffect(randomIntro)
      setCurrentPhase('intro')
      setKey(prev => prev + 1)
      return
    }
    
    if (currentPhase === 'stopped') return

    let timeoutId: number
    
    if (currentPhase === 'intro' && currentIntroEffect) {
      // Wait for intro animation to complete, then transition to hold
      const introDuration = parseFloat(currentIntroEffect.duration) * 1000
      timeoutId = window.setTimeout(() => {
        setCurrentPhase('hold')
      }, introDuration)
    }
    
    else if (currentPhase === 'hold') {
      // Hold for SENTENCE_DURATION +/- random variance
      const randomVariance = Math.random() * SENTENCE_DURATION_VAR
      const holdDuration = (SENTENCE_DURATION + randomVariance) * 1000
      timeoutId = window.setTimeout(() => {
        // Select random outro effect
        const outroOptions = outroEffects.length > 0 ? outroEffects : OUTRO_EFFECTS
        const randomOutro = outroOptions[Math.floor(Math.random() * outroOptions.length)]
        setCurrentOutroEffect(randomOutro)
        setCurrentPhase('outro')
        setKey(prev => prev + 1) // Trigger outro animation
      }, holdDuration)
    }
    
    else if (currentPhase === 'outro' && currentOutroEffect) {
      // Wait for outro animation to complete, then move to next line
      const outroDuration = parseFloat(currentOutroEffect.duration) * 1000
      timeoutId = window.setTimeout(() => {
        // Check if this was the last sentence
        if (currentIndex >= sentences.length - 1) {
          // Stay on last line
          setCurrentPhase('stopped')
        } else {
          // Move to next sentence
          const nextIndex = currentIndex + 1
          setCurrentIndex(nextIndex)
          
          // Select new random intro effect for next line
          const introOptions = allIntroOptions.length > 0 ? allIntroOptions : SELECTED_EFFECTS.filter(e => INTRO_EFFECT_NAMES.includes(e.name))
          const randomIntro = introOptions[Math.floor(Math.random() * introOptions.length)]
          setCurrentIntroEffect(randomIntro)
          setCurrentOutroEffect(null)
          setCurrentPhase('intro')
          setKey(prev => prev + 1) // Trigger intro animation
        }
      }, outroDuration)
    }
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [currentPhase, sentences, showSplash, showPoemExperience, currentIndex, currentIntroEffect, currentOutroEffect, allIntroOptions, outroEffects])

  const handleNext = () => {
    const nextSentenceIndex = (currentIndex + 1) % sentences.length
    const nextEffectIndex = (effectIndex + 1) % activeEffects.length
    
    setCurrentIndex(nextSentenceIndex)
    setEffectIndex(nextEffectIndex)
    setKey(prev => prev + 1) // Force animation to retrigger
    setPreviewEffectName(null) // Clear any preview effect
  }

  const handleSkipToOutro = () => {
    // Only allow skipping during intro or hold phases
    if (currentPhase === 'intro' || currentPhase === 'hold') {
      // Select random outro effect
      const outroOptions = outroEffects.length > 0 ? outroEffects : OUTRO_EFFECTS
      const randomOutro = outroOptions[Math.floor(Math.random() * outroOptions.length)]
      setCurrentOutroEffect(randomOutro)
      setCurrentPhase('outro')
      setKey(prev => prev + 1) // Trigger outro animation
    }
  }

  const handleOpenPoemExperience = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    setShowPoemExperience(true)
    setCurrentIndex(0)
    setCurrentPhase('stopped')
    setCurrentIntroEffect(null)
    setCurrentOutroEffect(null)
  }

  const toggleCurrentEffect = () => {
    if (!appliedEffect) return
    
    const newIncluded = new Set(includedEffects)
    if (newIncluded.has(appliedEffect.name)) {
      // Prevent removing the last effect
      if (newIncluded.size <= 1) {
        alert('You must keep at least one effect included!')
        return
      }
      newIncluded.delete(appliedEffect.name)
    } else {
      newIncluded.add(appliedEffect.name)
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

  // Use preview effect if set, otherwise determine effect based on current phase
  const previewedEffect = previewEffectName
    ? ALL_EFFECTS.find(e => e.name === previewEffectName) || null
    : null

  const appliedEffect = previewedEffect
    ?? (currentPhase === 'intro'
      ? currentIntroEffect
      : currentPhase === 'outro'
        ? currentOutroEffect
        : null)
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
        ) : !showPoemExperience ? (
          <section className="landing-gallery" aria-label="Select an artifact">
            <p className="landing-tagline">choose your instrument</p>
            <div className="landing-grid">
              <div className="landing-card landing-card--glass" aria-label="Glass experience placeholder">
                <div className="landing-image-wrap">
                  <span className="glass-blur" aria-hidden="true"></span>
                  <img src="/imgs/glass.png" alt="Vintage magnifying glass" loading="lazy" />
                </div>
                {/* <p className="landing-card-caption">glass • coming soon</p> */}
              </div>

              <div className="landing-card landing-card--measure" aria-label="Tape measure placeholder">
                <div className="landing-image-wrap">
                  <img src="/imgs/measure.png" alt="Tape measure" loading="lazy" />
                </div>
                {/* <p className="landing-card-caption">measure • coming soon</p> */}
              </div>

              <a
                href="#poem"
                className="landing-card landing-card--letters"
                onClick={handleOpenPoemExperience}
                role="button"
                aria-label="Enter the poem experience"
                title="Enter the poem experience"
              >
                <div className="landing-image-wrap">
                  <img src="/imgs/letters.png" alt="Stack of letters leading to the poem experience" loading="lazy" />
                </div>
                {/* <p className="landing-card-caption">letters • poem experience</p> */}
              </a>
            </div>
          </section>
        ) : (
          /* Main Content - Fades in after splash */
          <div 
            className={`poem-container ${!showSplash ? 'fade-in-content' : ''}`}
            onClick={handleSkipToOutro}
            style={{ cursor: sentences.length > 0 ? 'pointer' : 'default' }}
          >
            
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
            ) : sentences.length > 0 ? (
              <>
                <div className="sentence-display">
                  <p
                    key={key}
                    className={`sentence${appliedEffect ? ` ${appliedEffect.name}` : ''}`}
                  >
                    {currentSentence}
                  </p>
                </div>
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
      {isDebugMode && sentences.length > 0 && appliedEffect && !showSplash && (
        <div className="effect-info-bar">
          <div className="effect-info">
            <span className="info-label">Effect:</span>
            <span className="info-value">{appliedEffect.name}</span>
          </div>
          <div className="effect-info">
            <span className="info-label">Phase:</span>
            <span className="info-value">{currentPhase}</span>
          </div>
          <div className="effect-info">
            <span className="info-label">Progress:</span>
            <span className="info-value">
              Line {currentIndex + 1}/{sentences.length}
            </span>
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
        {isDebugMode && (
          <>
            <span className="footer-separator">•</span>
            <a 
              href="#effects" 
              className="footer-link"
              onClick={(e) => {
                e.preventDefault()
                setShowEffectPicker(true)
              }}
            >
              effect explorer
            </a>
          </>
        )}
      </footer>

      {/* About Modal */}
      {showAbout && (
        <div className="modal-overlay" onClick={() => setShowAbout(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAbout(false)}>×</button>
            <h2>About</h2>
            <div className="modal-body">
              <figure className="about-art">
                <img
                  src="/imgs/black_cat_left_gaze.png"
                  alt="Black cat gazing left in a dim detective office"
                  loading="lazy"
                />
                <figcaption>resident familiar, on permanent stakeout.</figcaption>
              </figure>
              <p className="about-copy">
                The Existential Detective Agency watches the thresholds where intuition, poetry, and
                cosmic paperwork intersect. The cat keeps score, the letters whisper, and every
                visitor becomes a co-conspirator.
              </p>
            </div>
            <div className="modal-credits">
              <p className="credit-link">
                <span><a href="https://svs.gsfc.nasa.gov/4655">Filed in the archives under "stray miracles".</a></span>
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
