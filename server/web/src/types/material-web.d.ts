import type * as React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'md-elevated-card': React.DetailedHTMLProps<React.HTMLAttributes<MdElevatedCardElement>, MdElevatedCardElement>;
      'md-filled-button': React.DetailedHTMLProps<React.HTMLAttributes<MdFilledButtonElement>, MdFilledButtonElement>;
      'md-outlined-button': React.DetailedHTMLProps<React.HTMLAttributes<MdOutlinedButtonElement>, MdOutlinedButtonElement>;
      'md-text-button': React.DetailedHTMLProps<React.HTMLAttributes<MdTextButtonElement>, MdTextButtonElement>;
      'md-icon-button': React.DetailedHTMLProps<React.HTMLAttributes<MdIconButtonElement>, MdIconButtonElement>;
      'md-fab': React.DetailedHTMLProps<React.HTMLAttributes<MdFabElement>, MdFabElement>;
      'md-outlined-text-field': React.DetailedHTMLProps<React.HTMLAttributes<MdOutlinedTextFieldElement>, MdOutlinedTextFieldElement>;
      'md-filled-text-field': React.DetailedHTMLProps<React.HTMLAttributes<MdFilledTextFieldElement>, MdFilledTextFieldElement>;
      'md-dialog': React.DetailedHTMLProps<React.HTMLAttributes<MdDialogElement>, MdDialogElement>;
      'md-list': React.DetailedHTMLProps<React.HTMLAttributes<MdListElement>, MdListElement>;
      'md-list-item': React.DetailedHTMLProps<React.HTMLAttributes<MdListItemElement>, MdListItemElement>;
      'md-menu': React.DetailedHTMLProps<React.HTMLAttributes<MdMenuElement>, MdMenuElement>;
      'md-menu-item': React.DetailedHTMLProps<React.HTMLAttributes<MdMenuItemElement>, MdMenuItemElement>;
      'md-switch': React.DetailedHTMLProps<React.HTMLAttributes<MdSwitchElement>, MdSwitchElement>;
      'md-linear-progress': React.DetailedHTMLProps<React.HTMLAttributes<MdLinearProgressElement>, MdLinearProgressElement>;
      'md-circular-progress': React.DetailedHTMLProps<React.HTMLAttributes<MdCircularProgressElement>, MdCircularProgressElement>;
      'md-snackbar': React.DetailedHTMLProps<React.HTMLAttributes<MdSnackbarElement>, MdSnackbarElement>;
      'md-radio': React.DetailedHTMLProps<React.HTMLAttributes<MdRadioElement>, MdRadioElement>;
      'md-checkbox': React.DetailedHTMLProps<React.HTMLAttributes<MdCheckboxElement>, MdCheckboxElement>;
      'md-divider': React.DetailedHTMLProps<React.HTMLAttributes<MdDividerElement>, MdDividerElement>;
      'md-filled-tonal-button': React.DetailedHTMLProps<React.HTMLAttributes<MdFilledTonalButtonElement>, MdFilledTonalButtonElement>;
      'md-outlined-card': React.DetailedHTMLProps<React.HTMLAttributes<MdOutlinedCardElement>, MdOutlinedCardElement>;
    }
  }

  interface HTMLElementTagNameMap {
    'md-elevated-card': MdElevatedCardElement;
    'md-filled-button': MdFilledButtonElement;
    'md-outlined-button': MdOutlinedButtonElement;
    'md-text-button': MdTextButtonElement;
    'md-icon-button': MdIconButtonElement;
    'md-fab': MdFabElement;
    'md-outlined-text-field': MdOutlinedTextFieldElement;
    'md-filled-text-field': MdFilledTextFieldElement;
    'md-dialog': MdDialogElement;
    'md-list': MdListElement;
    'md-list-item': MdListItemElement;
    'md-menu': MdMenuElement;
    'md-menu-item': MdMenuItemElement;
    'md-switch': MdSwitchElement;
    'md-linear-progress': MdLinearProgressElement;
    'md-circular-progress': MdCircularProgressElement;
    'md-snackbar': MdSnackbarElement;
    'md-radio': MdRadioElement;
    'md-checkbox': MdCheckboxElement;
    'md-divider': MdDividerElement;
    'md-filled-tonal-button': MdFilledTonalButtonElement;
    'md-outlined-card': MdOutlinedCardElement;
  }
}

interface MdDividerElement extends HTMLElement {}
interface MdFilledTonalButtonElement extends MdButtonElement {}
interface MdOutlinedCardElement extends MdElevatedCardElement {}

interface MdElevatedCardElement extends HTMLElement {
  readonly shadowRoot?: ShadowRoot;
}

interface MdButtonElement extends HTMLElement {
  disabled?: boolean;
  href?: string;
  target?: string;
  trailingIcon?: boolean;
  hasIcon?: boolean;
  type?: string;
}

interface MdFilledButtonElement extends MdButtonElement {}
interface MdOutlinedButtonElement extends MdButtonElement {}
interface MdTextButtonElement extends MdButtonElement {}

interface MdIconButtonElement extends HTMLElement {
  disabled?: boolean;
  toggle?: boolean;
  selected?: boolean;
  href?: string;
  target?: string;
  type?: string;
}

interface MdFabElement extends HTMLElement {
  label?: string;
  size?: 'small' | 'medium' | 'large';
  lowered?: boolean;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'surface';
  disabled?: boolean;
}

interface MdTextFieldElement extends HTMLElement {
  value: string;
  defaultValue?: string;
  type?: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readonly?: boolean;
  error?: boolean;
  errorText?: string;
  supportingText?: string;
  prefixText?: string;
  suffixText?: string;
  textDirection?: string;
  rows?: number;
  cols?: number;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  pattern?: string;
  validationMessage?: string;
  checkValidity: () => boolean;
  reportValidity: () => boolean;
  select: () => void;
  setSelectionRange: (start: number, end: number, direction?: 'forward' | 'backward' | 'none') => void;
}

interface MdOutlinedTextFieldElement extends MdTextFieldElement {}
interface MdFilledTextFieldElement extends MdTextFieldElement {}

interface MdDialogElement extends HTMLElement {
  open: boolean;
  returnValue: string;
  type?: 'alert';
  show: () => void;
  showModal: () => void;
  close: (returnValue?: string) => void;
}

interface MdListElement extends HTMLElement {}

interface MdListItemElement extends HTMLElement {
  disabled?: boolean;
  type?: 'text' | 'link' | 'button';
  href?: string;
  target?: string;
}

interface MdMenuElement extends HTMLElement {
  open: boolean;
  anchor?: HTMLElement | string;
  positioning?: 'absolute' | 'fixed';
  xOffset?: number;
  yOffset?: number;
  show: () => void;
  close: () => void;
}

interface MdMenuItemElement extends HTMLElement {
  disabled?: boolean;
  selected?: boolean;
  type?: 'text' | 'link' | 'button';
  href?: string;
  target?: string;
  headline?: string;
  supportingText?: string;
}

interface MdSwitchElement extends HTMLElement {
  selected?: boolean;
  disabled?: boolean;
  icons?: boolean;
  showOnlySelectedIcon?: boolean;
  required?: boolean;
}

interface MdLinearProgressElement extends HTMLElement {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  buffer?: number;
}

interface MdCircularProgressElement extends HTMLElement {
  value?: number;
  max?: number;
  indeterminate?: boolean;
  progress?: number;
}

interface MdSnackbarElement extends HTMLElement {
  open?: boolean;
  timeoutMs?: number;
  closeOnEscape?: boolean;
  labelText?: string;
  actionButtonText?: string;
  stacked?: boolean;
  leading?: boolean;
  show: () => void;
}

interface MdRadioElement extends HTMLElement {
  checked?: boolean;
  disabled?: boolean;
  value?: string;
  name?: string;
  required?: boolean;
}

interface MdCheckboxElement extends HTMLElement {
  checked?: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  value?: string;
  required?: boolean;
}

export {};
