import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { answerConfirm, getPendingConfirm, subscribeConfirm } from "@/lib/confirm-bus";

/** Draws the pending confirmation, if any. Mounted once, in the rail. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribeConfirm, getPendingConfirm, getPendingConfirm);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) answerConfirm(false); }}>
      {request === null ? null : (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{request.title}</DialogTitle>
            <DialogDescription>{request.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => answerConfirm(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" autoFocus onClick={() => answerConfirm(true)}>
              {request.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
