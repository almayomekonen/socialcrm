import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/components/lumen/utils';

const buttonVariants = cva(
  "inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive active:scale-98",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 hover:before:bg-primary/80 border-[0.8px] border-background/15 before:absolute relative before:-inset-0.25 before:content-[""] before:bg-primary before:-z-1 after:absolute after:inset-0 after:content-[""] after:bg-secondary hover:after:translate-y-full after:transition-all after:translate-y-[105%] after:blur-sm overflow-hidden',
        destructive:
          'bg-destructive text-white shadow-xl hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60',
        outline:
          'border bg-background shadow-none border-input hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xl hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        light:
          'bg-chart-4 border-[0.8px] font-medium border-foreground/10 before:absolute relative before:-inset-0.25 before:content-[""] before:chart-4 before:-z-1 after:absolute after:inset-0 after:content-[""] after:bg-primary/30 hover:after:translate-y-[95%] after:transition-all after:translate-y-[100%] after:blur-md overflow-hidden',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[_svg]:px-3 text-sm md:text-base',
        icon: 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
