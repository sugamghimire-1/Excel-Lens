import { useUI } from '@/state/uiStore';
import { AboutDialog, ConfirmDialog, PdfDialog, ShareDialog, ShortcutsDialog, StatsDialog } from './AppDialogs';
import { DuplicatesDialog, FindDialog, GoToDialog, LinkDialog, ShiftDialog, SizeDialog, SortDialog, SparklineDialog, SplitDialog, TableDialog } from './EditDialogs';
import { FormatDialog } from './FormatDialog';
import { ConditionalDialog, FunctionDialog, NamesDialog, ValidationDialog } from './RuleDialogs';

/** Renders the dialog that is currently open. */
export function Dialogs() {
  const d = useUI((s) => s.dialog);
  if (!d) return null;
  switch (d.type) {
    case 'find':
      return <FindDialog replace={d.replace} />;
    case 'goto':
      return <GoToDialog />;
    case 'conditional':
      return <ConditionalDialog key={`${d.preset}-${d.ruleId}`} preset={d.preset} ruleId={d.ruleId} />;
    case 'validation':
      return <ValidationDialog />;
    case 'sort':
      return <SortDialog />;
    case 'names':
      return <NamesDialog create={d.create} />;
    case 'function':
      return <FunctionDialog category={d.category} />;
    case 'link':
      return <LinkDialog />;
    case 'duplicates':
      return <DuplicatesDialog />;
    case 'split':
      return <SplitDialog />;
    case 'size':
      return <SizeDialog key={d.axis} axis={d.axis} />;
    case 'format':
      return <FormatDialog tab={d.tab} />;
    case 'shift':
      return <ShiftDialog mode={d.mode} />;
    case 'table':
      return <TableDialog styleId={d.styleId} />;
    case 'sparkline':
      return <SparklineDialog key={d.kind} kind={d.kind} />;
    case 'share':
      return <ShareDialog />;
    case 'pdf':
      return <PdfDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'stats':
      return <StatsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'confirm':
      return <ConfirmDialog key={d.title} dialog={d} />;
  }
}
