"use client";

import { useState } from "react";
import { Mail } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageSkeleton } from "@/components/page-skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export default function ComponentsDevPage() {
  const [date, setDate] = useState<Date | undefined>(new Date());

  return (
    <div className="mx-auto max-w-4xl space-y-10 p-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Component primitives</h1>
        <p className="text-muted-foreground text-sm">
          Every shadcn/ui primitive currently installed, for visual review and manual a11y checks.
        </p>
      </div>

      <Section title="Buttons">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
      </Section>

      <Section title="Badges">
        <Badge>Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
      </Section>

      <Section title="Avatar">
        <Avatar>
          <AvatarFallback>AN</AvatarFallback>
        </Avatar>
      </Section>

      <Section title="Form controls">
        <div className="grid w-full max-w-sm gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="dev-input">Label + input</Label>
            <Input id="dev-input" placeholder="Type something" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dev-textarea">Textarea</Label>
            <Textarea id="dev-textarea" placeholder="Longer text" />
          </div>
          <div className="grid gap-1.5">
            <Label>Select</Label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Choose a status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="dev-checkbox" />
            <Label htmlFor="dev-checkbox">Checkbox</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="dev-switch" />
            <Label htmlFor="dev-switch">Switch</Label>
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="board" className="w-full max-w-md">
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
          </TabsList>
          <TabsContent value="board">Kanban view goes here (Phase 2.3).</TabsContent>
          <TabsContent value="table">Table view goes here (Phase 2.4).</TabsContent>
          <TabsContent value="calendar">Calendar view goes here (Phase 2.5).</TabsContent>
        </Tabs>
      </Section>

      <Section title="Card">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description text.</CardDescription>
          </CardHeader>
          <CardContent>Card body content.</CardContent>
        </Card>
      </Section>

      <Section title="Table">
        <div className="w-full max-w-lg rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Design showcase robot chassis</TableCell>
                <TableCell>
                  <Badge variant="secondary">In progress</Badge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Book Curry ballroom for tournament</TableCell>
                <TableCell>
                  <Badge>Completed</Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Dialog, Sheet, Popover, Tooltip">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Task detail</DialogTitle>
              <DialogDescription>This is where the task detail panel will live.</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetTitle>Sheet content</SheetTitle>
          </SheetContent>
        </Sheet>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">Open popover</Button>
          </PopoverTrigger>
          <PopoverContent>Popover content.</PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Email">
              <Mail className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Send an email</TooltipContent>
        </Tooltip>
      </Section>

      <Section title="Calendar">
        <Calendar mode="single" selected={date} onSelect={setDate} className="rounded-md border" />
      </Section>

      <Section title="Skeleton / loading">
        <div className="w-full max-w-sm">
          <PageSkeleton rows={3} />
        </div>
        <Skeleton className="size-12 rounded-full" />
      </Section>

      <Section title="Empty state">
        <EmptyState
          title="Nothing here yet"
          description="This is the shared empty-state component used across every module."
          className="w-full max-w-md"
        />
      </Section>

      <Separator />
    </div>
  );
}
