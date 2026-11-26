import { createContext, useContext } from 'react'
import type { AssistantSelection } from './workspace'
/** ask: AI 창을 연다. question 과 submit 이 있으면 그 질문을 바로 보낸다(App askAssistant) */
export const AssistantBridge = createContext<{ ask: (selection?: AssistantSelection, question?: string, eventKey?: string, submit?: boolean) => void; isOpen?: boolean } | null>(null)
export const useAssistantBridge = () => useContext(AssistantBridge)
