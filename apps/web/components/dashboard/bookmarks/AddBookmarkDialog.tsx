"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus } from "lucide-react";

import BookmarkEditorForm from "./BookmarkEditorForm";

export default function AddBookmarkDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip delayDuration={100}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="secondary" size="icon" aria-label="Add bookmark">
              <Plus className="size-5" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipPortal>
          <TooltipContent>Add bookmark</TooltipContent>
        </TooltipPortal>
      </Tooltip>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add bookmark</DialogTitle>
          <DialogDescription>
            Paste a link or text, then choose where to save it.
          </DialogDescription>
        </DialogHeader>
        <BookmarkEditorForm
          compact={true}
          showListSelector={true}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
