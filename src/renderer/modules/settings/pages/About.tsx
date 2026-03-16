import { useState, useEffect } from 'react'

export function Component() {
  const [appVersion, setAppVersion] = useState('...')

  useEffect(() => {
    window.kordaAPI
      .getAppVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('unknown'))
  }, [])

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-text-primary">About</h2>
      <div className="space-y-3">
        <div className="flex justify-between py-2 border-b border-border">
          <span className="text-sm text-text-secondary">App Version</span>
          <span className="text-sm text-text-primary font-mono">{appVersion}</span>
        </div>
        <div className="flex justify-between py-2 border-b border-border">
          <span className="text-sm text-text-secondary">Platform</span>
          <span className="text-sm text-text-primary font-mono">{navigator.platform}</span>
        </div>
      </div>
      <p className="text-[11px] text-text-secondary opacity-60 mt-8">
        KORDA Studio — Built for engineering excellence
      </p>
    </div>
  )
}
