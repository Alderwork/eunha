import { useRef, useState } from 'react';
import { Stage, type StageHandle } from './Stage';
import { Welcome } from './scenes/Welcome';
import { ConnectGitHub } from './scenes/ConnectGitHub';
import { ImportStars } from './scenes/ImportStars';
import { Done } from './scenes/Done';
import { ReviewSuggestions } from './scenes/ReviewSuggestions';
import { FollowRecentStars } from './scenes/FollowRecentStars';
import {
  CONNECT_IDLE, CONNECT_VALIDATED,
  IMPORT_PEAK, IMPORT_CALMED, IMPORT_DONE, DONE as DONE_PRESET,
  type SceneParams,
} from '../../lib/orbScenes';

export type OnboardingCompleteOpts = {
  openAddModal?: boolean;
};

type Step = 1 | 2 | 3 | 4 | 5 | 6;

export function OnboardingFlow({
  onComplete,
}: {
  onComplete: (opts: OnboardingCompleteOpts) => void;
}) {
  const stageRef = useRef<StageHandle>(null);
  const [step, setStep] = useState<Step>(1);
  const breathTimeoutsRef = useRef<number[]>([]);

  function setSceneSafe(target: SceneParams, transitionMs?: number) {
    stageRef.current?.engine?.setScene(target, transitionMs);
  }
  function spawnSafe(n: number) {
    stageRef.current?.engine?.spawn(n);
  }
  function clearBreathTimeouts() {
    breathTimeoutsRef.current.forEach((id) => clearTimeout(id));
    breathTimeoutsRef.current = [];
  }

  // Initial scene = WELCOME (set on engine attach via OrbEngine default)

  function goToStep2() {
    setSceneSafe(CONNECT_IDLE, 600);
    setStep(2);
  }

  async function goToStep3() {
    // Burst on validation success
    setSceneSafe(CONNECT_VALIDATED, 400);
    spawnSafe(4);
    await new Promise(r => setTimeout(r, 800));
    setSceneSafe(IMPORT_PEAK, 600);
    setStep(3);
  }

  function goToStep4() {
    clearBreathTimeouts();
    setSceneSafe(DONE_PRESET, 800);
    setStep(4);
  }

  function settleImport() {
    clearBreathTimeouts();
    setSceneSafe(IMPORT_DONE, 800);
    const t1 = window.setTimeout(() => {
      setSceneSafe({ ...IMPORT_DONE, orbGlowMultiplier: 1.4 }, 300);
    }, 800);
    const t2 = window.setTimeout(() => {
      setSceneSafe(IMPORT_DONE, 300);
    }, 1100);
    breathTimeoutsRef.current = [t1, t2];
  }

  function calmImport() {
    clearBreathTimeouts();
    setSceneSafe(IMPORT_CALMED, 800);
  }

  function goToStep5() { setStep(5); }
  function goToStep6() { setStep(6); }
  function exitToManual() {
    onComplete({ openAddModal: true });
  }

  function exitToLibrary() {
    onComplete({});
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      {/* Traffic-light spacer for macOS */}
      <div data-tauri-drag-region className="flex-shrink-0 h-8" />

      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="mb-10">
          <Stage ref={stageRef} />
        </div>
        <div className="w-full max-w-md">
          {step === 1 && <Welcome onContinue={goToStep2} />}
          {step === 2 && (
            <ConnectGitHub
              onValidated={goToStep3}
              onSkipToManual={exitToManual}
              onSpawn={spawnSafe}
            />
          )}
          {step === 3 && (
            <ImportStars
              onSpawn={spawnSafe}
              onSettle={settleImport}
              onCalm={calmImport}
              onContinue={goToStep4}
            />
          )}
          {step === 4 && <ReviewSuggestions onContinue={goToStep5} />}
          {step === 5 && <FollowRecentStars onContinue={goToStep6} />}
          {step === 6 && <Done onContinue={exitToLibrary} />}
        </div>
      </main>
    </div>
  );
}
