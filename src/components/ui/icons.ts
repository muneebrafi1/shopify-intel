/**
 * Icon registry (Phosphor, MIT). Regular weight everywhere; `-fill` and `-bold` variants only
 * where noted in docs/DESIGN.md (ratings, saved state, pricing check marks). Icons are inlined at
 * build time (no client JS), so import only what we use.
 * Add an icon: import its raw SVG here and add it to `icons`. Names mirror Phosphor's.
 */
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';
import list from '@phosphor-icons/core/assets/regular/list.svg?raw';
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import caretLeft from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretUp from '@phosphor-icons/core/assets/regular/caret-up.svg?raw';
import arrowRight from '@phosphor-icons/core/assets/regular/arrow-right.svg?raw';
import arrowLeft from '@phosphor-icons/core/assets/regular/arrow-left.svg?raw';
import arrowUpRight from '@phosphor-icons/core/assets/regular/arrow-up-right.svg?raw';
import bookmarkSimple from '@phosphor-icons/core/assets/regular/bookmark-simple.svg?raw';
import check from '@phosphor-icons/core/assets/regular/check.svg?raw';
import desktop from '@phosphor-icons/core/assets/regular/desktop.svg?raw';
import deviceMobile from '@phosphor-icons/core/assets/regular/device-mobile.svg?raw';
import star from '@phosphor-icons/core/assets/regular/star.svg?raw';
import slidersHorizontal from '@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw';
import info from '@phosphor-icons/core/assets/regular/info.svg?raw';
import warning from '@phosphor-icons/core/assets/regular/warning.svg?raw';
import user from '@phosphor-icons/core/assets/regular/user.svg?raw';
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw';
import minus from '@phosphor-icons/core/assets/regular/minus.svg?raw';
import copy from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import linkSimple from '@phosphor-icons/core/assets/regular/link-simple.svg?raw';
import command from '@phosphor-icons/core/assets/regular/command.svg?raw';
import arrowsDownUp from '@phosphor-icons/core/assets/regular/arrows-down-up.svg?raw';
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw';
import rows from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import eye from '@phosphor-icons/core/assets/regular/eye.svg?raw';
import arrowClockwise from '@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import pencilSimple from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import lockSimple from '@phosphor-icons/core/assets/regular/lock-simple.svg?raw';
import checkCircle from '@phosphor-icons/core/assets/regular/check-circle.svg?raw';
import xCircle from '@phosphor-icons/core/assets/regular/x-circle.svg?raw';
import clock from '@phosphor-icons/core/assets/regular/clock.svg?raw';
import globe from '@phosphor-icons/core/assets/regular/globe.svg?raw';
import storefront from '@phosphor-icons/core/assets/regular/storefront.svg?raw';
import paintBrush from '@phosphor-icons/core/assets/regular/paint-brush.svg?raw';
import puzzlePiece from '@phosphor-icons/core/assets/regular/puzzle-piece.svg?raw';
import stack from '@phosphor-icons/core/assets/regular/stack.svg?raw';
import article from '@phosphor-icons/core/assets/regular/article.svg?raw';
import scales from '@phosphor-icons/core/assets/regular/scales.svg?raw';
import downloadSimple from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import signOut from '@phosphor-icons/core/assets/regular/sign-out.svg?raw';
import house from '@phosphor-icons/core/assets/regular/house.svg?raw';
import gear from '@phosphor-icons/core/assets/regular/gear.svg?raw';
import shieldCheck from '@phosphor-icons/core/assets/regular/shield-check.svg?raw';
import flag from '@phosphor-icons/core/assets/regular/flag.svg?raw';
import question from '@phosphor-icons/core/assets/regular/question.svg?raw';
import dotsThree from '@phosphor-icons/core/assets/regular/dots-three.svg?raw';
import arrowsOut from '@phosphor-icons/core/assets/regular/arrows-out.svg?raw';
import arrowSquareOut from '@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw';
import funnelSimple from '@phosphor-icons/core/assets/regular/funnel-simple.svg?raw';
import cornersOut from '@phosphor-icons/core/assets/regular/corners-out.svg?raw';
import sun from '@phosphor-icons/core/assets/regular/sun.svg?raw';
import moon from '@phosphor-icons/core/assets/regular/moon.svg?raw';
import monitor from '@phosphor-icons/core/assets/regular/monitor.svg?raw';
import caretUpDown from '@phosphor-icons/core/assets/regular/caret-up-down.svg?raw';
import tagSimple from '@phosphor-icons/core/assets/regular/tag-simple.svg?raw';
import browser from '@phosphor-icons/core/assets/regular/browser.svg?raw';
import table from '@phosphor-icons/core/assets/regular/table.svg?raw';
import signIn from '@phosphor-icons/core/assets/regular/sign-in.svg?raw';
import checkBold from '@phosphor-icons/core/assets/bold/check-bold.svg?raw';
import minusBold from '@phosphor-icons/core/assets/bold/minus-bold.svg?raw';
import starFill from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import bookmarkSimpleFill from '@phosphor-icons/core/assets/fill/bookmark-simple-fill.svg?raw';
import checkCircleFill from '@phosphor-icons/core/assets/fill/check-circle-fill.svg?raw';

export const icons = {
  'magnifying-glass': magnifyingGlass,
  x: x,
  list: list,
  'caret-down': caretDown,
  'caret-right': caretRight,
  'caret-left': caretLeft,
  'caret-up': caretUp,
  'arrow-right': arrowRight,
  'arrow-left': arrowLeft,
  'arrow-up-right': arrowUpRight,
  'bookmark-simple': bookmarkSimple,
  check: check,
  desktop: desktop,
  'device-mobile': deviceMobile,
  star: star,
  'sliders-horizontal': slidersHorizontal,
  info: info,
  warning: warning,
  user: user,
  plus: plus,
  minus: minus,
  copy: copy,
  'link-simple': linkSimple,
  command: command,
  'arrows-down-up': arrowsDownUp,
  'squares-four': squaresFour,
  rows: rows,
  eye: eye,
  'arrow-clockwise': arrowClockwise,
  trash: trash,
  'pencil-simple': pencilSimple,
  'lock-simple': lockSimple,
  'check-circle': checkCircle,
  'x-circle': xCircle,
  clock: clock,
  globe: globe,
  storefront: storefront,
  'paint-brush': paintBrush,
  'puzzle-piece': puzzlePiece,
  stack: stack,
  article: article,
  scales: scales,
  'download-simple': downloadSimple,
  'sign-out': signOut,
  house: house,
  gear: gear,
  'shield-check': shieldCheck,
  flag: flag,
  question: question,
  'dots-three': dotsThree,
  'arrows-out': arrowsOut,
  'arrow-square-out': arrowSquareOut,
  'funnel-simple': funnelSimple,
  'corners-out': cornersOut,
  sun: sun,
  moon: moon,
  monitor: monitor,
  'caret-up-down': caretUpDown,
  'tag-simple': tagSimple,
  browser: browser,
  table: table,
  'sign-in': signIn,
  'check-bold': checkBold,
  'minus-bold': minusBold,
  'star-fill': starFill,
  'bookmark-simple-fill': bookmarkSimpleFill,
  'check-circle-fill': checkCircleFill,
} as const satisfies Record<string, string>;

export type IconName = keyof typeof icons;
