import { useEffect } from 'react'
import { X } from 'lucide-react'

export interface ToastMessage {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

/** 화면 아래 알림 한 줄. 8초 뒤 사라진다. 등록 직후 되돌리기, 취소 직후 위협 보기에 쓴다. */
export default function Toast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 8000)
    return () => window.clearTimeout(timer)
  }, [toast.id, onClose])

  return (
    <div className="ex-toast" role="status" aria-live="polite">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          type="button"
          className="ex-toast-action"
          onClick={() => {
            toast.action!.run()
            onClose()
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="ex-toast-close" aria-label="알림 닫기" onClick={onClose}>
        <X size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
