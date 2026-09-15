import type * as React from 'react';

type CustomElementProps<T> = React.DetailedHTMLProps<React.HTMLAttributes<T>, T> & {
  [K in keyof T]?: any;
} & {
  slot?: string;
  class?: string;
  type?: string;
  [key: string]: any;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-elevated-card': CustomElementProps<MdElevatedCardElement>;
      'md-filled-button': CustomElementProps<MdFilledButtonElement>;
      'md-outlined-button': CustomElementProps<MdOutlinedButtonElement>;
      'md-text-button': CustomElementProps<MdTextButtonElement>;
      'md-icon-button': CustomElementProps<MdIconButtonElement>;
      'md-fab': CustomElementProps<MdFabElement>;
      'md-outlined-text-field': CustomElementProps<MdOutlinedTextFieldElement>;
      'md-filled-text-field': CustomElementProps<MdFilledTextFieldElement>;
      'md-dialog': CustomElementProps<MdDialogElement>;
      'md-list': CustomElementProps<MdListElement>;
      'md-list-item': CustomElementProps<MdListItemElement>;
      'md-menu': CustomElementProps<MdMenuElement>;
      'md-menu-item': CustomElementProps<MdMenuItemElement>;
      'md-switch': CustomElementProps<MdSwitchElement>;
      'md-linear-progress': CustomElementProps<MdLinearProgressElement>;
      'md-circular-progress': CustomElementProps<MdCircularProgressElement>;
      'md-snackbar': CustomElementProps<MdSnackbarElement>;
      'md-radio': CustomElementProps<MdRadioElement>;
      'md-checkbox': CustomElementProps<MdCheckboxElement>;
      'md-divider': CustomElementProps<MdDividerElement>;
      'md-filled-tonal-button': CustomElementProps<MdFilledTonalButtonElement>;
      'md-outlined-card': CustomElementProps<MdOutlinedCardElement>;
    }
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'md-elevated-card': CustomElementProps<MdElevatedCardElement>;
      'md-filled-button': CustomElementProps<MdFilledButtonElement>;
      'md-outlined-button': CustomElementProps<MdOutlinedButtonElement>;
      'md-text-button': CustomElementProps<MdTextButtonElement>;
      'md-icon-button': CustomElementProps<MdIconButtonElement>;
      'md-fab': CustomElementProps<MdFabElement>;
      'md-outlined-text-field': CustomElementProps<MdOutlinedTextFieldElement>;
      'md-filled-text-field': CustomElementProps<MdFilledTextFieldElement>;
      'md-dialog': CustomElementProps<MdDialogElement>;
      'md-list': CustomElementProps<MdListElement>;
      'md-list-item': CustomElementProps<MdListItemElement>;
      'md-menu': CustomElementProps<MdMenuElement>;
      'md-menu-item': CustomElementProps<MdMenuItemElement>;
      'md-switch': CustomElementProps<MdSwitchElement>;
      'md-linear-progress': CustomElementProps<MdLinearProgressElement>;
      'md-circular-progress': CustomElementProps<MdCircularProgressElement>;
      'md-snackbar': CustomElementProps<MdSnackbarElement>;
      'md-radio': CustomElementProps<MdRadioElement>;
      'md-checkbox': CustomElementProps<MdCheckboxElement>;
      'md-divider': CustomElementProps<MdDividerElement>;
      'md-filled-tonal-button': CustomElementProps<MdFilledTonalButtonElement>;
      'md-outlined-card': CustomElementProps<MdOutlinedCardElement>;
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'md-elevated-card': CustomElementProps<MdElevatedCardElement>;
      'md-filled-button': CustomElementProps<MdFilledButtonElement>;
      'md-outlined-button': CustomElementProps<MdOutlinedButtonElement>;
      'md-text-button': CustomElementProps<MdTextButtonElement>;
      'md-icon-button': CustomElementProps<MdIconButtonElement>;
      'md-fab': CustomElementProps<MdFabElement>;
      'md-outlined-text-field': CustomElementProps<MdOutlinedTextFieldElement>;
      'md-filled-text-field': CustomElementProps<MdFilledTextFieldElement>;
      'md-dialog': CustomElementProps<MdDialogElement>;
      'md-list': CustomElementProps<MdListElement>;
      'md-list-item': CustomElementProps<MdListItemElement>;
      'md-menu': CustomElementProps<MdMenuElement>;
      'md-menu-item': CustomElementProps<MdMenuItemElement>;
      'md-switch': CustomElementProps<MdSwitchElement>;
      'md-linear-progress': CustomElementProps<MdLinearProgressElement>;
      'md-circular-progress': CustomElementProps<MdCircularProgressElement>;
      'md-snackbar': CustomElementProps<MdSnackbarElement>;
      'md-radio': CustomElementProps<MdRadioElement>;
      'md-checkbox': CustomElementProps<MdCheckboxElement>;
      'md-divider': CustomElementProps<MdDividerElement>;
      'md-filled-tonal-button': CustomElementProps<MdFilledTonalButtonElement>;
      'md-outlined-card': CustomElementProps<MdOutlinedCardElement>;
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
    step?: string;
    min?: string;
    max?: string;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    autofocus?: boolean;
    checkValidity: () => boolean;
    reportValidity: () => boolean;
    select: () => void;
    setSelectionRange: (start: number, end: number) => void;
  }

  interface MdOutlinedTextFieldElement extends MdTextFieldElement {}
  interface MdFilledTextFieldElement extends MdTextFieldElement {}

  interface MdDialogElement extends HTMLElement {
    open?: boolean;
    quick?: boolean;
    returnValue?: string;
    show: () => void;
    close: (returnValue?: string) => void;
  }

  interface MdListElement extends HTMLElement {}

  interface MdListItemElement extends HTMLElement {
    disabled?: boolean;
    type?: 'text' | 'button' | 'link';
    href?: string;
    target?: string;
    headline?: string;
    supportingText?: string;
    trailingSupportingText?: string;
  }

  interface MdMenuElement extends HTMLElement {
    anchor?: string | HTMLElement;
    open?: boolean;
    quick?: boolean;
    stayOpenOnOutsideClick?: boolean;
    stayOpenOnFocusout?: boolean;
    positioning?: 'absolute' | 'fixed' | 'document' | 'popover';
    show: () => void;
    close: () => void;
  }

  interface MdMenuItemElement extends HTMLElement {
    disabled?: boolean;
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
}
