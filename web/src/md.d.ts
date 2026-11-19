import type * as React from 'react';

type MD = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, any>;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'md-filled-button': MD;
      'md-outlined-button': MD;
      'md-text-button': MD;
      'md-filled-tonal-button': MD;
      'md-icon-button': MD;
      'md-outlined-text-field': MD;
      'md-dialog': MD;
      'md-filter-chip': MD;
      'md-chip-set': MD;
      'md-circular-progress': MD;
      'md-divider': MD;
      'md-switch': MD;
      'md-outlined-select': MD;
      'md-select-option': MD;
      'md-ripple': MD;
    }
  }
}
