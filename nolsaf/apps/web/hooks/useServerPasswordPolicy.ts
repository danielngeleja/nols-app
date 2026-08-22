"use client"

import { useCallback, useEffect, useState } from "react"
import {
  DEFAULT_PASSWORD_POLICY,
  fetchPasswordPolicy,
  type PasswordPolicy,
} from "@/lib/passwordPolicy"

export type PasswordPolicyStatus = "loading" | "ready" | "error"

export function useServerPasswordPolicy() {
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY)
  const [status, setStatus] = useState<PasswordPolicyStatus>("loading")
  const [attempt, setAttempt] = useState(0)

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setStatus("loading")
    fetchPasswordPolicy(controller.signal)
      .then((nextPolicy) => {
        if (controller.signal.aborted) return
        setPolicy(nextPolicy)
        setStatus("ready")
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error")
      })
    return () => controller.abort()
  }, [attempt])

  return {
    policy,
    policyReady: status === "ready",
    policyStatus: status,
    retryPolicy: retry,
  }
}
