/*
 * bot-avatars 0.1.1 (Jakub Antalik, MIT, see LICENSE beside this file),
 * vendored into DEX so its face can be replaced.
 *
 * DEX's changes, all marked "DEX:":
 *  - the face is drawn by ./expressions (lids, brows, expressive mouths,
 *    blush, swirl, tears) instead of the stock capsule eyes and cup mouth;
 *  - BotAvatar takes an `expression` prop, eased per instance.
 * Everything else (bodies, materials, motion) is the library as published.
 */
import { jsx as Es } from "react/jsx-runtime";
// DEX: the expressive face.
import { drawExpressiveFace } from "./expressions";
import { forwardRef as Is, useRef as $t, useImperativeHandle as $s, useId as Ys, useLayoutEffect as Xs, useEffect as Ie } from "react";
const ce = {
  clover: { label: "Clover", color: "#35B8FF", face: "eyes", faceX: 50, faceY: 50, faceScale: 1 },
  flower: { label: "Flower", color: "#2FCB7A", face: "eyes", faceX: 50, faceY: 51, faceScale: 0.95 },
  triangle: { label: "Triangle", color: "#DC48FF", face: "eyes", faceX: 50, faceY: 61, faceScale: 0.9 },
  square: { label: "Square", color: "#35B8FF", face: "eyes", faceX: 50, faceY: 50, faceScale: 1 },
  blob: { label: "Blob", color: "#2FCB7A", face: "eyes", faceX: 49.5, faceY: 50, faceScale: 1 },
  ghost: { label: "Ghost", color: "#F4F2FA", face: "eyes", faceX: 50, faceY: 48, faceScale: 0.95 },
  circle: { label: "Circle", color: "#9A62FF", face: "eyes", faceX: 50, faceY: 50, faceScale: 1 },
  drop: { label: "Drop", color: "#1ED3C6", face: "eyes", faceX: 50, faceY: 62, faceScale: 0.9 },
  star: { label: "Star", color: "#FFD32B", face: "eyes", faceX: 50, faceY: 52, faceScale: 0.82 },
  droid: { label: "Droid", color: "#D5DBEA", face: "eyes", faceX: 50, faceY: 60, faceScale: 0.95 },
  mech: { label: "Mech", color: "#95A6C4", face: "eyes", faceX: 50, faceY: 59, faceScale: 1 },
  alien: { label: "Alien", color: "#9BE85A", face: "eyes", faceX: 50, faceY: 45, faceScale: 1.05 },
  hexagon: { label: "Hexagon", color: "#FF2A2A", face: "eyes", faceX: 50, faceY: 50, faceScale: 0.95 },
  cat: { label: "Cat", color: "#FF8C42", face: "eyes", faceX: 50, faceY: 58, faceScale: 1 },
  cloud: { label: "Cloud", color: "#CFE6FF", face: "eyes", faceX: 50, faceY: 58, faceScale: 0.95 },
  pill: { label: "Pill", color: "#7B77F0", face: "eyes", faceX: 50, faceY: 50, faceScale: 0.9 },
  pebble: { label: "Pebble", color: "#2FCB7A", face: "eyes", faceX: 50, faceY: 50, faceScale: 0.95 },
  puddle: { label: "Puddle", color: "#FF2A2A", face: "eyes", faceX: 50, faceY: 50, faceScale: 0.95 }
}, qs = Object.keys(ce), Xa = ["eyes", "mouth"], qa = ["default", "working", "sleeping"], Ra = Object.fromEntries(
  qs.map((t) => [t, ce[t].color])
), $e = {
  default: "idle",
  working: "working",
  sleeping: "sleeping"
}, Ye = {
  clover: "M26.53 22.38A25 25 0 0 1 73.47 22.38A7 7 0 0 0 77.62 26.53A25 25 0 0 1 77.62 73.47A7 7 0 0 0 73.47 77.62A25 25 0 0 1 26.53 77.62A7 7 0 0 0 22.38 73.47A25 25 0 0 1 22.38 26.53A7 7 0 0 0 26.53 22.38Z",
  flower: "M31.2 19.82A20.5 20.5 0 0 1 68.8 19.82A5 5 0 0 0 72.9 22.8A20.5 20.5 0 0 1 84.51 58.55A5 5 0 0 0 82.95 63.37A20.5 20.5 0 0 1 52.54 85.47A5 5 0 0 0 47.46 85.47A20.5 20.5 0 0 1 17.05 63.37A5 5 0 0 0 15.49 58.55A20.5 20.5 0 0 1 27.1 22.8A5 5 0 0 0 31.2 19.82Z",
  triangle: "M38.75 27.43A13 13 0 0 1 61.25 27.43L82.7 64.49A13 13 0 0 1 71.45 84L28.55 84A13 13 0 0 1 17.3 64.49L38.75 27.43Z",
  square: "M93 50C93 53.66 92.96 58.23 92.88 60.97C92.8 63.71 92.67 64.81 92.51 66.44C92.35 68.08 92.15 69.44 91.9 70.77C91.66 72.1 91.37 73.3 91.04 74.44C90.72 75.58 90.35 76.63 89.94 77.63C89.53 78.63 89.07 79.55 88.58 80.43C88.08 81.31 87.54 82.13 86.96 82.9C86.37 83.67 85.75 84.39 85.07 85.07C84.39 85.75 83.67 86.37 82.9 86.96C82.13 87.54 81.31 88.08 80.43 88.58C79.55 89.07 78.63 89.53 77.63 89.94C76.63 90.35 75.58 90.72 74.44 91.04C73.3 91.37 72.1 91.66 70.77 91.9C69.44 92.15 68.08 92.35 66.44 92.51C64.81 92.67 63.71 92.8 60.97 92.88C58.23 92.96 53.66 93 50 93C46.34 93 41.77 92.96 39.03 92.88C36.29 92.8 35.19 92.67 33.56 92.51C31.92 92.35 30.56 92.15 29.23 91.9C27.9 91.66 26.7 91.37 25.56 91.04C24.42 90.72 23.37 90.35 22.37 89.94C21.37 89.53 20.45 89.07 19.57 88.58C18.69 88.08 17.87 87.54 17.1 86.96C16.33 86.37 15.61 85.75 14.93 85.07C14.25 84.39 13.63 83.67 13.04 82.9C12.46 82.13 11.92 81.31 11.42 80.43C10.93 79.55 10.47 78.63 10.06 77.63C9.65 76.63 9.28 75.58 8.96 74.44C8.63 73.3 8.34 72.1 8.1 70.77C7.85 69.44 7.65 68.08 7.49 66.44C7.33 64.81 7.2 63.71 7.12 60.97C7.04 58.23 7 53.66 7 50C7 46.34 7.04 41.77 7.12 39.03C7.2 36.29 7.33 35.19 7.49 33.56C7.65 31.92 7.85 30.56 8.1 29.23C8.34 27.9 8.63 26.7 8.96 25.56C9.28 24.42 9.65 23.37 10.06 22.37C10.47 21.37 10.93 20.45 11.42 19.57C11.92 18.69 12.46 17.87 13.04 17.1C13.63 16.33 14.25 15.61 14.93 14.93C15.61 14.25 16.33 13.63 17.1 13.04C17.87 12.46 18.69 11.92 19.57 11.42C20.45 10.93 21.37 10.47 22.37 10.06C23.37 9.65 24.42 9.28 25.56 8.96C26.7 8.63 27.9 8.34 29.23 8.1C30.56 7.85 31.92 7.65 33.56 7.49C35.19 7.33 36.29 7.2 39.03 7.12C41.77 7.04 46.34 7 50 7C53.66 7 58.23 7.04 60.97 7.12C63.71 7.2 64.81 7.33 66.44 7.49C68.08 7.65 69.44 7.85 70.77 8.1C72.1 8.34 73.3 8.63 74.44 8.96C75.58 9.28 76.63 9.65 77.63 10.06C78.63 10.47 79.55 10.93 80.43 11.42C81.31 11.92 82.13 12.46 82.9 13.04C83.67 13.63 84.39 14.25 85.07 14.93C85.75 15.61 86.37 16.33 86.96 17.1C87.54 17.87 88.08 18.69 88.58 19.57C89.07 20.45 89.53 21.37 89.94 22.37C90.35 23.37 90.72 24.42 91.04 25.56C91.37 26.7 91.66 27.9 91.9 29.23C92.15 30.56 92.35 31.92 92.51 33.56C92.67 35.19 92.8 36.29 92.88 39.03C92.96 41.77 93 46.34 93 50Z",
  blob: "M93.92 50C94.18 51.9 94.24 53.9 93.99 55.79C93.73 57.68 93.18 59.61 92.39 61.36C91.6 63.1 90.48 64.78 89.27 66.27C88.07 67.76 86.58 69.08 85.14 70.29C83.7 71.49 82.1 72.5 80.62 73.5C79.14 74.49 77.64 75.34 76.24 76.24C74.84 77.15 73.51 78 72.2 78.93C70.88 79.86 69.66 80.83 68.36 81.8C67.06 82.76 65.78 83.82 64.39 84.74C63 85.67 61.55 86.63 60.01 87.35C58.47 88.08 56.82 88.73 55.15 89.1C53.48 89.47 51.71 89.64 50 89.57C48.29 89.5 46.55 89.16 44.91 88.68C43.27 88.21 41.67 87.47 40.16 86.72C38.65 85.96 37.24 85.02 35.86 84.13C34.48 83.24 33.19 82.29 31.89 81.37C30.58 80.46 29.32 79.56 28.03 78.63C26.74 77.71 25.44 76.82 24.16 75.84C22.88 74.86 21.57 73.87 20.36 72.74C19.15 71.62 17.95 70.42 16.91 69.1C15.88 67.79 14.92 66.35 14.15 64.85C13.38 63.35 12.76 61.73 12.29 60.1C11.81 58.48 11.52 56.78 11.29 55.1C11.06 53.41 10.98 51.71 10.91 50C10.83 48.29 10.83 46.59 10.83 44.84C10.84 43.1 10.85 41.34 10.93 39.53C11.02 37.72 11.09 35.86 11.34 33.99C11.59 32.12 11.88 30.16 12.43 28.31C12.99 26.46 13.69 24.56 14.66 22.88C15.64 21.21 16.86 19.58 18.27 18.27C19.69 16.96 21.4 15.84 23.17 15.03C24.93 14.22 26.95 13.71 28.89 13.43C30.83 13.15 32.9 13.21 34.82 13.36C36.74 13.5 38.66 13.92 40.43 14.28C42.2 14.65 43.87 15.16 45.46 15.54C47.06 15.93 48.52 16.31 50 16.58C51.48 16.85 52.87 17.02 54.32 17.17C55.77 17.32 57.22 17.36 58.71 17.49C60.2 17.62 61.74 17.7 63.28 17.95C64.81 18.19 66.39 18.5 67.91 18.98C69.43 19.46 70.95 20.08 72.38 20.83C73.81 21.58 75.19 22.5 76.5 23.5C77.81 24.5 79.03 25.63 80.22 26.81C81.41 27.99 82.54 29.25 83.65 30.57C84.76 31.89 85.85 33.26 86.89 34.72C87.93 36.18 88.98 37.69 89.9 39.31C90.82 40.92 91.73 42.64 92.4 44.42C93.07 46.2 93.66 48.1 93.92 50Z",
  ghost: "M17 50C17 31.78 31.78 17 50 17C68.22 17 83 31.78 83 50V81.5Q72 93.5 61 81.5Q50 93.5 39 81.5Q28 93.5 17 81.5Z",
  circle: "M50 8A42 42 0 1 1 50 92A42 42 0 1 1 50 8Z",
  drop: "M50 8.5C52.2 8.5 53.4 10.3 56.4 15.2C62.9 25.5 84 44.6 84 61.5C84 80.3 68.8 92 50 92C31.2 92 16 80.3 16 61.5C16 44.6 37.1 25.5 43.6 15.2C46.6 10.3 47.8 8.5 50 8.5Z",
  star: "M45.77 9.7A5 5 0 0 1 54.23 9.7L65.02 26.81A4 4 0 0 0 67.42 28.55L87.02 33.53A5 5 0 0 1 89.63 41.57L76.7 57.12A4 4 0 0 0 75.78 59.94L77.11 80.12A5 5 0 0 1 70.26 85.09L51.48 77.59A4 4 0 0 0 48.52 77.59L29.74 85.09A5 5 0 0 1 22.89 80.12L24.22 59.94A4 4 0 0 0 23.3 57.12L10.37 41.57A5 5 0 0 1 12.98 33.53L32.58 28.55A4 4 0 0 0 34.98 26.81L45.77 9.7Z",
  droid: "M16 50C16 38.95 24.95 30 36 30H64C75.05 30 84 38.95 84 50V70C84 81.05 75.05 90 64 90H36C24.95 90 16 81.05 16 70ZM4 62A7 7 0 1 1 18 62A7 7 0 1 1 4 62ZM82 62A7 7 0 1 1 96 62A7 7 0 1 1 82 62Z",
  mech: "M10 48C10 38.06 18.06 30 28 30H72C81.94 30 90 38.06 90 48V70C90 79.94 81.94 88 72 88H28C18.06 88 10 79.94 10 70ZM3 54C3 51.79 4.79 50 7 50H11V72H7C4.79 72 3 70.21 3 68ZM89 50H93C95.21 50 97 51.79 97 54V68C97 70.21 95.21 72 93 72H89Z",
  alien: "M50 10C70 10 83 27 83 46C83 65 64 92 50 92C36 92 17 65 17 46C17 27 30 10 50 10Z",
  hexagon: "M91.4 45.5A9 9 0 0 1 91.4 54.5L74.6 83.61A9 9 0 0 1 66.8 88.11L33.2 88.11A9 9 0 0 1 25.4 83.61L8.6 54.5A9 9 0 0 1 8.6 45.5L25.4 16.39A9 9 0 0 1 33.2 11.89L66.8 11.89A9 9 0 0 1 74.6 16.39L91.4 45.5Z",
  cat: "M50 20A36 36 0 1 1 50 92A36 36 0 1 1 50 20ZM24.72 44.64A4.5 4.5 0 0 1 17.35 40.67L20.21 16.66A4.5 4.5 0 0 1 26.86 13.26L42.3 21.83A4.5 4.5 0 0 1 43.02 29.21L24.72 44.64ZM82.65 40.67A4.5 4.5 0 0 1 75.28 44.64L56.98 29.21A4.5 4.5 0 0 1 57.7 21.83L73.14 13.26A4.5 4.5 0 0 1 79.79 16.66L82.65 40.67Z",
  cloud: "M19 44A25 25 0 1 1 69 44A25 25 0 1 1 19 44ZM47 50A21 21 0 1 1 89 50A21 21 0 1 1 47 50ZM7 68A17 17 0 1 1 41 68A17 17 0 1 1 7 68ZM32 73A18 18 0 1 1 68 73A18 18 0 1 1 32 73ZM60 70A16 16 0 1 1 92 70A16 16 0 1 1 60 70Z",
  pill: "M28 28H72C84.15 28 94 37.85 94 50C94 62.15 84.15 72 72 72H28C15.85 72 6 62.15 6 50C6 37.85 15.85 28 28 28Z",
  pebble: "M94.6 50C94.71 51.92 94.56 53.93 94.17 55.82C93.79 57.7 93.13 59.6 92.28 61.33C91.44 63.06 90.32 64.72 89.1 66.19C87.87 67.67 86.41 69.01 84.92 70.16C83.42 71.31 81.75 72.29 80.11 73.1C78.47 73.92 76.73 74.55 75.06 75.06C73.39 75.58 71.7 75.91 70.1 76.2C68.5 76.48 66.93 76.62 65.45 76.76C63.96 76.9 62.55 76.94 61.2 77.03C59.84 77.11 58.57 77.16 57.31 77.26C56.05 77.36 54.86 77.48 53.64 77.63C52.42 77.79 51.24 77.98 50 78.18C48.76 78.39 47.52 78.64 46.2 78.85C44.89 79.06 43.53 79.3 42.11 79.46C40.69 79.61 39.2 79.75 37.67 79.77C36.14 79.78 34.54 79.74 32.95 79.54C31.35 79.33 29.7 79.03 28.1 78.55C26.49 78.07 24.86 77.45 23.33 76.67C21.8 75.88 20.29 74.94 18.92 73.85C17.54 72.77 16.23 71.51 15.08 70.16C13.94 68.8 12.9 67.29 12.04 65.72C11.17 64.16 10.45 62.46 9.91 60.74C9.36 59.03 8.98 57.22 8.76 55.43C8.55 53.64 8.5 51.8 8.6 50C8.71 48.2 8.98 46.39 9.38 44.65C9.79 42.91 10.35 41.19 11.02 39.56C11.7 37.92 12.52 36.34 13.43 34.85C14.34 33.37 15.39 31.96 16.5 30.66C17.61 29.36 18.84 28.15 20.11 27.07C21.39 25.98 22.76 25 24.15 24.15C25.54 23.3 27.01 22.56 28.48 21.95C29.94 21.33 31.46 20.85 32.95 20.46C34.44 20.08 35.95 19.83 37.43 19.66C38.91 19.48 40.38 19.43 41.81 19.43C43.24 19.43 44.64 19.53 46.01 19.66C47.37 19.78 48.7 19.98 50 20.18C51.3 20.39 52.57 20.63 53.83 20.87C55.1 21.11 56.34 21.37 57.6 21.62C58.87 21.87 60.13 22.12 61.43 22.39C62.74 22.66 64.07 22.93 65.45 23.24C66.83 23.56 68.25 23.88 69.72 24.3C71.19 24.72 72.71 25.17 74.25 25.75C75.78 26.34 77.37 27 78.91 27.81C80.46 28.63 82.04 29.56 83.5 30.66C84.97 31.75 86.43 33 87.7 34.38C88.98 35.77 90.19 37.32 91.17 38.97C92.14 40.62 92.98 42.43 93.56 44.27C94.13 46.1 94.5 48.08 94.6 50Z",
  puddle: "M85.34 50C85.65 51.54 85.9 53.13 86.01 54.74C86.11 56.35 86.11 58 85.95 59.63C85.8 61.26 85.51 62.93 85.07 64.52C84.62 66.12 84.03 67.72 83.3 69.23C82.58 70.74 81.7 72.21 80.72 73.57C79.74 74.94 78.62 76.23 77.43 77.43C76.24 78.62 74.93 79.72 73.58 80.73C72.23 81.74 70.79 82.65 69.33 83.48C67.86 84.31 66.34 85.04 64.79 85.71C63.24 86.37 61.65 86.95 60.04 87.46C58.42 87.96 56.77 88.4 55.1 88.75C53.43 89.09 51.72 89.37 50 89.54C48.28 89.71 46.52 89.81 44.76 89.76C43.01 89.72 41.22 89.58 39.47 89.29C37.72 89 35.95 88.58 34.26 88C32.57 87.42 30.89 86.69 29.33 85.8C27.77 84.92 26.26 83.87 24.91 82.7C23.56 81.53 22.3 80.19 21.23 78.77C20.16 77.35 19.22 75.79 18.47 74.2C17.71 72.61 17.13 70.91 16.7 69.23C16.26 67.55 16.02 65.81 15.88 64.13C15.75 62.45 15.78 60.76 15.88 59.14C15.97 57.52 16.21 55.94 16.45 54.42C16.7 52.89 17.03 51.43 17.34 50C17.65 48.57 18 47.2 18.32 45.83C18.63 44.46 18.94 43.13 19.24 41.76C19.53 40.39 19.79 39.03 20.08 37.61C20.36 36.18 20.62 34.74 20.95 33.23C21.28 31.72 21.61 30.16 22.07 28.57C22.52 26.98 23.02 25.32 23.69 23.69C24.35 22.06 25.11 20.38 26.05 18.79C26.99 17.21 28.08 15.62 29.33 14.2C30.58 12.78 32 11.41 33.54 10.26C35.08 9.12 36.8 8.11 38.57 7.35C40.34 6.6 42.27 6.04 44.17 5.73C46.08 5.43 48.08 5.37 50 5.54C51.92 5.71 53.87 6.15 55.69 6.75C57.52 7.36 59.3 8.22 60.94 9.19C62.57 10.15 64.11 11.33 65.51 12.56C66.91 13.78 68.17 15.15 69.33 16.52C70.48 17.89 71.5 19.34 72.44 20.76C73.38 22.18 74.19 23.62 74.97 25.03C75.75 26.43 76.44 27.83 77.12 29.19C77.8 30.56 78.42 31.89 79.05 33.23C79.67 34.57 80.28 35.87 80.87 37.21C81.46 38.55 82.05 39.88 82.6 41.27C83.14 42.65 83.68 44.05 84.14 45.51C84.6 46.96 85.03 48.46 85.34 50Z"
}, Xe = {
  droid: "M47.5 14H52.5V32H47.5ZM43 11A7 7 0 1 1 57 11A7 7 0 1 1 43 11Z",
  mech: "M19.5 32L24.5 32L17 13L12 13ZM75.5 32L80.5 32L88 13L83 13ZM10 11.5A4.5 4.5 0 1 1 19 11.5A4.5 4.5 0 1 1 10 11.5ZM81 11.5A4.5 4.5 0 1 1 90 11.5A4.5 4.5 0 1 1 81 11.5Z"
};
function Fe(t) {
  const e = t.trim(), s = e.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (s) return Os([Number(s[1]) / 360, Number(s[2]) / 100, Number(s[3]) / 100]);
  const a = e.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (a) {
    let o = a[1];
    o.length === 3 && (o = o.split("").map((c) => c + c).join(""));
    const r = parseInt(o, 16);
    return [r >> 16 & 255, r >> 8 & 255, r & 255];
  }
  const i = e.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return i ? [Number(i[1]), Number(i[2]), Number(i[3])] : null;
}
function Rs(t) {
  const e = Fe(t);
  if (!e) return 0.5;
  const s = (a) => {
    const i = a / 255;
    return i <= 0.03928 ? i / 12.92 : ((i + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * s(e[0]) + 0.7152 * s(e[1]) + 0.0722 * s(e[2]);
}
const Ws = "#1E1A33", _s = "#F7F5F2";
function Ds(t) {
  return Rs(t) < 0.13 ? _s : Ws;
}
function Zs([t, e, s]) {
  t /= 255, e /= 255, s /= 255;
  const a = Math.max(t, e, s), i = Math.min(t, e, s), o = (a + i) / 2;
  if (a === i) return [0, 0, o];
  const r = a - i, c = o > 0.5 ? r / (2 - a - i) : r / (a + i);
  let n = 0;
  return a === t ? n = (e - s) / r + (e < s ? 6 : 0) : a === e ? n = (s - t) / r + 2 : n = (t - e) / r + 4, [n / 6, c, o];
}
function Os([t, e, s]) {
  if (e === 0) return [s * 255, s * 255, s * 255];
  const a = s < 0.5 ? s * (1 + e) : s + e - s * e, i = 2 * s - a, o = (r) => (r = (r % 1 + 1) % 1, r < 1 / 6 ? i + (a - i) * 6 * r : r < 1 / 2 ? a : r < 2 / 3 ? i + (a - i) * (2 / 3 - r) * 6 : i);
  return [o(t + 1 / 3) * 255, o(t) * 255, o(t - 1 / 3) * 255];
}
function Hs([t, e, s]) {
  return `hsl(${(t * 360).toFixed(1)} ${(e * 100).toFixed(1)}% ${(s * 100).toFixed(1)}%)`;
}
const qe = (t) => Math.min(1, Math.max(0, t));
function mt(t, e, s = 0) {
  const a = Fe(t);
  if (!a) return t;
  const [i, o, r] = Zs(a);
  return Hs([i, qe(o + s + (e < 0 ? -e * 0.25 : 0)), qe(r + e)]);
}
const se = ["default", "working", "sleeping"], ae = 0.68, ms = 26, Vs = 0.2, Re = { height: ms, time: ae, stretch: 1, squash: 1.15, squashTime: 0.37, squashEase: "pulse", groundTime: 0.11, groundEase: "pulse", riseTime: 0.33, riseEase: "pulse", clickSquashTime: 0.24, spin: 1, lean: 6, every: 8, land: 0 }, Ms = (t, e) => e ? t.clickSquashTime : Vs * t.time, pe = (t, e) => Ms(t, e) + t.time + Cs[t.squashEase] * (e ? t.clickSquashTime : t.squashTime) + Math.max(0, t.groundTime) + t.riseTime + Math.max(0, t.land) + 0.05, Cs = { sharp: 0, pulse: 2 / 7, soft: 0.5, bouncy: 0.144 }, We = (t, e) => {
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  switch (e) {
    case "sharp":
      return (1 - t) * (1 - t);
    case "soft":
      return 0.5 + 0.5 * Math.cos(Math.PI * t);
    case "bouncy":
      return Math.exp(-3.2 * t) * Math.cos(5.4 * t) - t * t * t * 0.026;
    default: {
      const s = 4.2 * t;
      return (1 + s) * Math.exp(-s) - t * t * t * 0.078;
    }
  }
}, _e = (t, e) => 1 + 0.25 * ys(t, e), ys = (t, e) => {
  if (t <= 0 || t >= 1) return 0;
  let s;
  switch (e) {
    case "sharp":
      s = (1 - t) * (1 - t);
      break;
    case "soft":
      s = Math.sin(Math.PI * t) ** 2;
      break;
    case "bouncy":
      s = Math.exp(-3.15 * t) * Math.sin(8.43 * t) / 0.596;
      break;
    default: {
      const i = 7 * t;
      s = i * i * Math.exp(2 - i) / 4;
    }
  }
  const a = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
  return s * a * a * (3 - 2 * a);
}, me = (t) => Math.exp(-Math.pow(Math.min(Math.abs(t), Math.abs(t - 1)) / 0.11, 2)), ct = Math.PI / 180, vt = Math.PI * 2, Ks = { default: 1.2, working: 0.7, sleeping: 1.4 }, Gs = 1;
function Bs(t) {
  let e = t * 2654435761 >>> 0 || 1;
  return () => {
    e = e + 1831565813 >>> 0;
    let s = e;
    return s = Math.imul(s ^ s >>> 15, s | 1), s ^= s + Math.imul(s ^ s >>> 7, s | 61), ((s ^ s >>> 14) >>> 0) / 4294967296;
  };
}
function Et(t, e, s, a) {
  return t + (e - t) * (1 - Math.exp(-s * a));
}
const _t = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, zs = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
class Dt {
  /* A channel that picks a new target now and then and moves to it. The
     head channels move as a lightly damped spring — the turn starts and
     ends softly, the way a head does — while the eyes dart with an
     exponential approach, the way eyes do. */
  constructor(e, s, a, i, o, r = !1) {
    this.rand = e, this.amp = s, this.holdMin = a, this.holdMax = i, this.rate = o, this.spring = r, this.value = 0, this.vel = 0, this.target = 0, this.next = 0;
  }
  update(e, s) {
    if (e >= this.next && (this.target = (this.rand() * 2 - 1) * this.amp, this.next = e + this.holdMin + this.rand() * (this.holdMax - this.holdMin)), this.spring) {
      const a = this.rate * 1.6, i = 0.9;
      this.vel += (a * a * (this.target - this.value) - 2 * i * a * this.vel) * s, this.value += this.vel * s;
    } else this.value = Et(this.value, this.target, this.rate, s);
  }
  /** aim at a value and stay there: the rig picks the next one */
  aim(e) {
    this.target = e, this.next = 1 / 0;
  }
  set(e, s, a, i) {
    this.amp = e, this.holdMin = s, this.holdMax = a, this.rate = i, this.next = 0;
  }
}
class Zt {
  constructor(e) {
    this.duration = e, this.p = -1;
  }
  fire() {
    this.p = 0;
  }
  get active() {
    return this.p >= 0;
  }
  update(e) {
    this.p < 0 || (this.p += e / this.duration, this.p >= 1 && (this.p = -1));
  }
}
const De = 35 * ct, Ze = 14 * ct, Oe = 3.2 * ct, He = 2.6, js = 4.4, gs = {
  default: { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 },
  working: { pitch: 5 * ct, roll: 0, y: 0, lookX: 0, lookY: 0 },
  sleeping: { pitch: -16 * ct, roll: 6 * ct, y: 3, lookX: 0, lookY: 1 }
};
class Us {
  constructor(e, s = "default") {
    this.pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0, lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0] }, this.state = "default", this.t = 0, this.wFrom = [1, 0, 0], this.tr = 1, this.trDuration = 1.2, this.blink = new Zt(0.17), this.blinkAgain = !1, this.dart = new Zt(0.12), this.dartX = 0, this.dartY = 0, this.flip = new Zt(pe(Re, !1)), this.flipPoked = !1, this.jump = { ...Re }, this.flipSide = 1, this.nod = new Zt(1.7), this.hopPhase = 0, this.hopCount = 0, this.hopGain = 0, this.laughEv = new Zt(0.8), this.prevYaw = 0, this.jelly = 0, this.jellyV = 0, this.gazeLead = 0, this.gazeDir = [0, 0], this.gazeAt = 0, this.turnK = 1, this.breathPhase = 0, this.ptrX = 0, this.ptrY = 0, this.ptrS = 0, this.ptrTargetX = 0, this.ptrTargetY = 0, this.ptrTargetS = 0, this.baseYaw = 0, this.rand = Bs(Math.floor(e * 1e6) + 1);
    const a = this.rand;
    this.yawW = new Dt(a, 36 * ct, 1.1, 2.6, 3, !0), this.pitchW = new Dt(a, 10 * ct, 1.1, 2.6, 2.6, !0), this.rollW = new Dt(a, 5 * ct, 1.6, 3.2, 2, !0), this.lookXW = new Dt(a, 3.6, 0.5, 2, 14), this.lookYW = new Dt(a, 2.4, 0.5, 2, 14), this.t = a() * 10, this.hopPhase = a(), this.breathPhase = a(), this.blinkAt = this.t + 1 + a() * 3, this.flipAt = this.nextFlip(this.t, 1), this.nodAt = this.t + 3 + a() * 4, this.dartAt = this.t + 1 + a() * 2, this.laughAt = this.t + 0.6 + a() * 1.5, this.setState(s, !0);
  }
  setState(e, s = !1) {
    if (e === this.state && !s) return;
    const a = this.state;
    this.state = e;
    const i = this.pose.w;
    if (s) {
      for (let o = 0; o < 3; o++) i[o] = se[o] === e ? 1 : 0;
      this.tr = 1;
    } else
      this.wFrom = [i[0], i[1], i[2]], this.tr = 0, this.trDuration = a === "sleeping" ? Gs : Ks[e];
    switch (e) {
      case "default":
        this.yawW.set(De, 2.6, 5.4, 2), this.pitchW.set(Ze, 2.8, 5.8, 1.8), this.rollW.set(Oe, 3.4, 6.6, 1.5), this.gazeAt = 0, this.gazeDir = [0, 0], this.lookXW.set(3.6, 0.6, 2.2, 13), this.lookYW.set(2.4, 0.6, 2.2, 13), this.flipAt = this.nextFlip(this.t, 0.6);
        break;
      case "working":
        this.yawW.set(16 * ct, 0.9, 1.8, 4), this.pitchW.set(3 * ct, 1.2, 2.4, 3), this.rollW.set(0, 1, 2, 3), this.lookXW.set(2, 0.5, 1.2, 12), this.lookYW.set(1, 0.5, 1.2, 12), this.hopPhase = 0, this.hopCount = 0, this.laughAt = this.t + 0.5 + this.rand() * 1.2;
        break;
      case "sleeping":
        this.yawW.set(7 * ct, 3, 6, 0.7), this.pitchW.set(3 * ct, 3, 6, 0.7), this.rollW.set(2 * ct, 3, 6, 0.6), this.lookXW.set(0, 2, 4, 2), this.lookYW.set(0, 2, 4, 2), this.nodAt = this.t + 2.5 + this.rand() * 4;
        break;
    }
  }
  /** Where the pointer is, relative to the head (−1 … 1 across a head
      width), and how strongly to follow it (0 lets go). */
  setPointer(e, s, a) {
    this.ptrTargetX = Math.max(-1.2, Math.min(1.2, e)), this.ptrTargetY = Math.max(-1.2, Math.min(1.2, s)), this.ptrTargetS = Math.max(0, Math.min(1, a));
  }
  /** A hop and a full turn, right now, whatever the state. */
  poke() {
    this.flip.active && this.flip.p < 0.6 || (this.flipPoked = !0, this.flip.duration = pe(this.jump, !0), this.flipSide = this.rand() < 0.5 ? -1 : 1, this.flip.fire(), this.flipAt = this.nextFlip(this.t, 1.1));
  }
  /** How far the head turns to the side while idle: 1 as the gaze has
      it, 0 keeps it facing forward. */
  setTurn(e) {
    const s = Math.max(0, e);
    s !== this.turnK && (this.turnK = s, this.state === "default" && (this.gazeAt = 0));
  }
  /** The jump's numbers; any subset. */
  setJump(e) {
    const s = this.jump.every;
    Object.assign(this.jump, e), e.every !== void 0 && e.every !== s && (this.flipAt = this.nextFlip(this.t, 1));
  }
  /* Where the head looks next. From a corner it mostly swings straight
     across to the opposite one — top right, stay, bottom left — now and
     then only sideways, or back to the middle for a beat. */
  nextGaze() {
    const e = this.rand, [s, a] = this.gazeDir;
    if (s !== 0 || a !== 0) {
      const o = e();
      return o < 0.66 ? [-s, -a] : o < 0.85 ? [-s, a] : [0, 0];
    }
    const i = [
      [1, -1],
      [-1, 1],
      [-1, -1],
      [1, 1]
    ];
    return i[Math.floor(e() * i.length)];
  }
  /** when the next idle jump is due: `every` seconds, give or take 40 % */
  nextFlip(e, s) {
    const a = this.jump.every;
    return a > 0 ? e + a * s * (0.625 + this.rand() * 0.75) : 1 / 0;
  }
  /** Advance by `dt` seconds (already scaled by the speed). */
  update(e) {
    e = Math.min(e, 0.05), this.t += e;
    const s = this.t, a = this.pose, i = a.w;
    if (this.tr < 1) {
      this.tr = Math.min(1, this.tr + e / this.trDuration);
      const f = zs(this.tr);
      for (let k = 0; k < 3; k++) {
        const Y = se[k] === this.state ? 1 : 0;
        i[k] = this.wFrom[k] + (Y - this.wFrom[k]) * f;
      }
    }
    const [o, r, c] = i, n = { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 };
    for (let f = 0; f < 3; f++) {
      const k = gs[se[f]];
      n.pitch += k.pitch * i[f], n.roll += k.roll * i[f], n.y += k.y * i[f], n.lookX += k.lookX * i[f], n.lookY += k.lookY * i[f];
    }
    if (this.state === "default" && s >= this.gazeAt) {
      const [f, k] = this.nextGaze();
      this.gazeDir = [f, k];
      const Y = 0.84 + this.rand() * 0.16;
      this.yawW.aim(f * De * Y * this.turnK), this.pitchW.aim(k * Ze * Y), this.rollW.aim(f * Oe * Y * this.turnK), this.gazeAt = s + He + this.rand() * (js - He);
    }
    this.yawW.update(s, e), this.pitchW.update(s, e), this.rollW.update(s, e), this.lookXW.update(s, e), this.lookYW.update(s, e), this.ptrS = Et(this.ptrS, this.ptrTargetS, 8, e), this.ptrX = Et(this.ptrX, this.ptrTargetX, 14, e), this.ptrY = Et(this.ptrY, this.ptrTargetY, 14, e);
    const h = this.ptrS, l = 1 - 0.75 * h;
    this.baseYaw = Et(this.baseYaw, this.yawW.value * l + 22 * ct * this.ptrX * h, 5, e);
    const d = n.pitch + this.pitchW.value * l - 12 * ct * this.ptrY * h, m = n.roll + this.rollW.value * l, p = n.y, u = n.lookX + this.lookXW.value * l + 4.5 * this.ptrX * h, A = n.lookY + this.lookYW.value * l + 3 * this.ptrY * h;
    let M = 0, S = 0, E = 1, I = 1, g = 0, T = 0, P = 0, W = 0, b = 0, C = 0, $ = 0, x = 0;
    const y = (f, k, Y) => {
      const q = Math.min(1, Math.max(0, (Y - f) / (k - f)));
      return q * q * (3 - 2 * q);
    }, v = (f) => y(0.1, 0.26, f) * (1 - y(0.66, 0.9, f)), L = (f) => vt * (1.5 * f + 0.9 * _t(f));
    if (s >= this.blinkAt && !this.blink.active && o + r > 0.5 && (this.blink.fire(), this.blinkAgain = !this.blinkAgain && this.rand() < 0.22, this.blinkAt = s + (this.blinkAgain ? 0.28 : 2.2 + this.rand() * 2.6)), this.blink.update(e), this.blink.active && (P = Math.sin(Math.PI * this.blink.p)), s >= this.dartAt && !this.dart.active && o + r > 0.5 && (this.dart.fire(), this.dartX = (this.rand() * 2 - 1) * 4, this.dartY = (this.rand() * 2 - 1) * 2, this.dart.duration = 0.25 + this.rand() * 0.45, this.dartAt = s + 1.2 + this.rand() * 2.6), this.dart.update(e), this.dart.active) {
      const f = this.dart.p, k = f < 0.15 ? f / 0.15 : f > 0.8 ? (1 - f) / 0.2 : 1;
      W += this.dartX * k * (o + r), b += this.dartY * k * (o + r);
    }
    if (this.state === "default" && s >= this.flipAt && !this.flip.active && (this.flipPoked = !1, this.flip.duration = pe(this.jump, !1), this.flipSide = this.rand() < 0.5 ? -1 : 1, this.flip.fire(), this.flipAt = this.nextFlip(s, 1)), this.flip.update(e), this.flip.active) {
      const f = this.jump, k = Ms(f, this.flipPoked), Y = (this.flip.p * this.flip.duration - k) / f.time, q = Math.min(1, Math.max(0, Y)), w = Math.sin(Math.PI * q);
      M += vt * f.spin * _t(q), S -= f.height * w;
      const X = (Y - 1) * f.time - f.land, F = this.flipPoked ? f.clickSquashTime : f.squashTime, _ = (ht) => this.flipPoked ? ht * ht * (3 - 2 * ht) : me(ht - 1), O = Math.max(0, f.groundTime), V = Cs[f.squashEase] * F, nt = X - V - O, rt = X <= V ? ys(X / F, f.squashEase) : nt <= 0 ? _e((X - V) / O, f.groundEase) : We(nt / f.riseTime, f.riseEase), it = (Y < 0 ? _(Math.max(0, 1 + Y * f.time / k)) : X > 0 ? rt : Y < 0.2 ? me(Y) : 0) * f.squash;
      E += 0.16 * it - 0.06 * w * f.stretch, I += -0.18 * it + 0.09 * w * f.stretch, T += this.flipSide * f.lean * ct * w, f.spin > 0 && (C = Math.max(C, w), $ = Math.max($, v(q)), x = L(q));
    }
    const G = this.jump, j = Math.max(0, G.groundTime), ft = j + G.riseTime;
    if (this.state === "working" && (this.hopGain = r), this.hopGain > 0.02 && (this.state === "working" || this.hopPhase > 0)) {
      this.hopPhase += e / ae, this.hopPhase >= 1 && (this.state === "working" ? (this.hopPhase -= 1, this.hopCount += 1) : (this.hopPhase - 1) * ae >= ft && (this.hopPhase = 0, this.hopGain = 0));
      const f = this.hopGain, k = Math.min(1, this.hopPhase), Y = Math.sin(Math.PI * k), q = this.hopCount % 3 === 2;
      S -= (q ? ms : 18) * Y * f;
      const X = this.state !== "working" && this.hopPhase > 1 ? (this.hopPhase - 1) * ae : -1, F = X < 0 ? me(this.hopPhase) : X < j ? _e(X / j, G.groundEase) : We((X - j) / G.riseTime, G.riseEase);
      E += (0.16 * F - 0.06 * Y) * f, I += (-0.18 * F + 0.09 * Y) * f, q && (M += vt * _t(k) * f, C = Math.max(C, Y * f), v(k) * f > $ && ($ = v(k) * f, x = L(k))), T += (this.hopCount % 2 === 0 ? 1 : -1) * 6 * ct * Y * f;
    }
    if (this.state === "working" && s >= this.laughAt && !this.laughEv.active && (this.laughEv.fire(), this.laughEv.duration = 0.6 + this.rand() * 0.5, this.laughAt = s + 1.6 + this.rand() * 2.2), this.laughEv.update(e), this.laughEv.active) {
      const f = this.laughEv.p;
      C = Math.max(C, f < 0.18 ? f / 0.18 : f > 0.78 ? (1 - f) / 0.22 : 1);
    }
    if (this.state === "sleeping" && s >= this.nodAt && !this.nod.active && (this.nod.fire(), this.nodAt = s + 4 + this.rand() * 4), this.nod.update(e), this.nod.active) {
      const f = this.nod.p, k = f < 0.72 ? _t(f / 0.72) : 1 - _t((f - 0.72) / 0.28);
      g -= 13 * ct * k * c;
    }
    this.breathPhase += e / (3.6 + 1.2 * c);
    const R = Math.sin(this.breathPhase * vt);
    a.breath = R, E += R * (8e-3 + 0.014 * c), I += R * (0.012 + 0.02 * c);
    const H = Math.sin(s * vt / 3.4) * 2 * (1 - c);
    a.yaw = this.baseYaw + M;
    let Z = this.baseYaw - this.prevYaw;
    Z = ((Z + Math.PI) % vt + vt) % vt - Math.PI, this.prevYaw = this.baseYaw;
    const B = e > 0 ? Math.abs(Z) / e : 0, U = e > 0 ? Math.max(-2.2, Math.min(2.2, Z / e * 2.4)) : 0;
    this.gazeLead = Et(this.gazeLead, U, 9, e);
    const N = Math.min(0.22, 0.055 * B), at = 16, tt = 0.45;
    this.jellyV += (at * at * (N - this.jelly) - 2 * tt * at * this.jellyV) * e, this.jelly += this.jellyV * e;
    const Q = Math.max(-0.08, Math.min(0.28, this.jelly)) * 0.6;
    E *= 1 + Q, I *= 1 - 0.55 * Q, a.pitch = d + g, a.roll = m + T, a.x = 0, a.y = p + S + H, a.sx = E, a.sy = I, a.eyeOpen = 1, a.laugh = Et(a.laugh, C, 30, e), a.blinkL = P, a.blinkR = P, a.lookX = u + W + this.gazeLead, a.lookY = A + b, a.whirl = $, a.whirlAngle = x;
  }
}
function Ve(t) {
  const e = gs[t];
  return {
    yaw: 0,
    pitch: e.pitch,
    roll: e.roll,
    x: 0,
    y: e.y,
    sx: 1,
    sy: 1,
    eyeOpen: 1,
    blinkL: 0,
    blinkR: 0,
    lookX: e.lookX,
    lookY: e.lookY,
    breath: 0,
    laugh: 0,
    whirl: 0,
    whirlAngle: 0,
    w: se.map((s) => s === t ? 1 : 0)
  };
}
const xt = 3, Ft = 100 + 2 * xt, ot = 64, Wa = ot, ne = ot * ot, Me = 24, Qs = 1e12, As = 48 * Math.PI / 180, Ke = Math.cos(As), Js = Math.sin(As), Ce = 17, Ns = (t, e) => e + (1 - e) * Math.sqrt(Math.max(0, 1 - t * t));
function Ge(t, e, s, a, i, o) {
  let r = 0;
  i[0] = 0, o[0] = -1e30, o[1] = 1e30;
  for (let c = 1; c < e; c++) {
    let n = 0;
    for (; ; ) {
      const h = i[r];
      if (n = (t[c] + c * c - t[h] - h * h) / (2 * (c - h)), n > o[r]) break;
      r--;
    }
    r++, i[r] = c, o[r] = n, o[r + 1] = 1e30;
  }
  r = 0;
  for (let c = 0; c < e; c++) {
    for (; o[r + 1] < c; ) r++;
    const n = i[r];
    s[c] = (c - n) * (c - n) + t[n], a[c] = n;
  }
}
function Be(t, e, s, a, i) {
  const o = new Float32Array(s), r = new Float32Array(s), c = new Int32Array(s), n = new Int32Array(s), h = new Float32Array(s + 1), l = new Float32Array(s * s), d = new Int32Array(s * s);
  for (let m = 0; m < s; m++) {
    for (let p = 0; p < s; p++) o[p] = t[p * s + m] === e ? 0 : Qs;
    Ge(o, s, r, c, n, h);
    for (let p = 0; p < s; p++)
      l[p * s + m] = r[p], d[p * s + m] = c[p];
  }
  for (let m = 0; m < s; m++) {
    const p = m * s;
    for (let u = 0; u < s; u++) o[u] = l[p + u];
    Ge(o, s, r, c, n, h);
    for (let u = 0; u < s; u++)
      a[p + u] = r[u], i && (i[p + u] = d[p + c[u]] * s + c[u]);
  }
}
function ye(t, e, s) {
  for (let a = 0; a < e; a++) {
    const i = a * e;
    for (let o = 0; o < e; o++) {
      const r = o < 2 ? 0 : o - 2, c = o < 1 ? 0 : o - 1, n = o > e - 2 ? e - 1 : o + 1, h = o > e - 3 ? e - 1 : o + 2;
      s[i + o] = (t[i + r] + 4 * t[i + c] + 6 * t[i + o] + 4 * t[i + n] + t[i + h]) * 0.0625;
    }
  }
  for (let a = 0; a < e; a++)
    for (let i = 0; i < e; i++) {
      const o = i < 2 ? 0 : i - 2, r = i < 1 ? 0 : i - 1, c = i > e - 2 ? e - 1 : i + 1, n = i > e - 3 ? e - 1 : i + 2;
      t[i * e + a] = (s[o * e + a] + 4 * s[r * e + a] + 6 * s[i * e + a] + 4 * s[c * e + a] + s[n * e + a]) * 0.0625;
    }
}
function ta(t, e, s) {
  const a = [];
  for (let o = e, r = 1; r <= 4 && o % 2 === 0 || r === 1; o >>= 1, r <<= 1) {
    const c = new Uint8Array(o * o);
    for (let n = 0; n < o; n++)
      for (let h = 0; h < o; h++) {
        let l = 0;
        for (let d = 0; d < r; d++) for (let m = 0; m < r; m++) l += t[(n * r + d) * e + h * r + m];
        c[n * o + h] = l >= 128 * r * r ? 1 : 0;
      }
    if (a.push({ n: o, mask: c, phi: new Float32Array(o * o) }), r === 4) break;
  }
  const i = (o, r, c, n) => {
    const { n: h, mask: l, phi: d } = o, m = r * r;
    for (let p = 0; p < c; p++)
      for (let u = 1; u < h - 1; u++) {
        const A = u * h;
        for (let M = 1; M < h - 1; M++) {
          const S = A + M;
          if (!l[S]) continue;
          const E = (d[S - 1] + d[S + 1] + d[S - h] + d[S + h] + m) * 0.25;
          d[S] += n * (E - d[S]);
        }
      }
  };
  for (let o = a.length - 1; o >= 0; o--) {
    const r = a[o], c = 1 << o;
    if (o < a.length - 1) {
      const h = a[o + 1], l = r.n, d = h.n;
      for (let m = 0; m < l; m++) {
        const p = Math.min(d - 1, Math.max(0, (m + 0.5) / 2 - 0.5)), u = p | 0, A = Math.min(d - 1, u + 1), M = p - u;
        for (let S = 0; S < l; S++) {
          const E = m * l + S;
          if (!r.mask[E]) continue;
          const I = Math.min(d - 1, Math.max(0, (S + 0.5) / 2 - 0.5)), g = I | 0, T = Math.min(d - 1, g + 1), P = I - g;
          r.phi[E] = (h.phi[u * d + g] * (1 - P) + h.phi[u * d + T] * P) * (1 - M) + (h.phi[A * d + g] * (1 - P) + h.phi[A * d + T] * P) * M;
        }
      }
    }
    const n = Math.min(1.9, 2 / (1 + Math.sin(Math.PI / r.n)) - 0.05);
    i(r, s * c, 4, 1), i(r, s * c, o === 2 ? 100 : o === 1 ? 30 : 16, n), i(r, s * c, 8, 1);
  }
  return a[0].phi;
}
const ea = [1, 1, 0, -1, -1, -1, 0, 1], sa = [0, 1, 1, 1, 0, -1, -1, -1], aa = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];
function na(t, e, s) {
  const a = Ft / e, i = e * e, o = new Uint8Array(i);
  for (let C = 0; C < i; C++) o[C] = t[C] >= 128 ? 1 : 0;
  const r = new Float32Array(i), c = new Float32Array(i), n = new Int32Array(i);
  Be(o, 0, e, r, null), Be(o, 1, e, c, n);
  const h = new Float32Array(i), l = new Float32Array(i);
  for (let C = 0; C < i; C++) {
    const $ = t[C] / 255;
    h[C] = a * ($ > 0 && $ < 1 ? $ - 0.5 : o[C] ? Math.sqrt(r[C]) - 0.5 : 0.5 - Math.sqrt(c[C]));
  }
  ye(h, e, l), ye(h, e, l);
  const d = ta(t, e, a);
  let m = 0;
  for (let C = 0; C < i; C++) d[C] > m && (m = d[C]);
  const p = 2 * Math.sqrt(m), u = Math.min(0.9 * s + 0.12 * p, 1.2 * p), A = m > 0 ? u / Math.sqrt(m) : 0, M = new Float32Array(i);
  for (let C = 0; C < i; C++) M[C] = d[C] > 0 ? A * Math.sqrt(d[C]) : 0;
  ye(M, e, l);
  const S = { N: e, i00: new Uint16Array(i), wx: new Uint8Array(i), wy: new Uint8Array(i), ao: new Uint8Array(i) }, { i00: E, wx: I, wy: g, ao: T } = S, P = e <= 64 ? [1, 2, 3, 5, 8] : e <= 96 ? [1, 2, 4, 7, 11] : [1, 2, 4, 7, 11, 15], W = 9, b = e - 1;
  for (let C = 0; C < e; C++)
    for (let $ = 0; $ < e; $++) {
      const x = C * e + $, y = o[x] ? x : c[x] <= W ? n[x] : -1;
      if (y < 0) continue;
      const v = y % e, L = (y - v) / e, G = v > 0 ? v - 1 : 0, j = v < b ? v + 1 : b, ft = L > 0 ? L - 1 : 0, R = L < b ? L + 1 : b;
      let H = -(M[L * e + j] - M[L * e + G]) / (2 * a), Z = -(M[R * e + v] - M[ft * e + v]) / (2 * a), B = 1, U = Math.sqrt(H * H + Z * Z + 1);
      H /= U, Z /= U, B /= U;
      const N = Math.max(0, h[y]);
      if (N < 2) {
        let F = h[L * e + j] - h[L * e + G], _ = h[R * e + v] - h[ft * e + v];
        const O = Math.hypot(F, _) || 1;
        F /= O, _ /= O;
        const V = 0.7 * (1 - N / 2);
        H += V * (-F - H), Z += V * (-_ - Z), B += V * (0 - B), U = Math.sqrt(H * H + Z * Z + B * B) || 1, H /= U, Z /= U, B /= U;
      }
      const at = M[y];
      let tt = 0;
      for (let F = 0; F < 8; F++) {
        let _ = 0;
        for (let O = 0; O < P.length; O++) {
          const V = P[O];
          let nt = v + ea[F] * V, rt = L + sa[F] * V;
          nt < 0 ? nt = 0 : nt > b && (nt = b), rt < 0 ? rt = 0 : rt > b && (rt = b);
          const it = (M[rt * e + nt] - at) / (V * a * aa[F]);
          it > _ && (_ = it);
        }
        tt += _ / Math.sqrt(1 + _ * _);
      }
      const Q = 1 - Math.min(1, N / 3), f = 1 - 0.2 * Q * Q, k = Math.pow(1 - 0.9 * tt / 8, 1.5) * f;
      T[x] = Math.max(1, Math.round(255 * Math.pow(k, 1 / 2.2)));
      const Y = (H * 0.5 + 0.5) * (ot - 1), q = (Z * 0.5 + 0.5) * (ot - 1), w = Math.min(ot - 2, Math.max(0, Y | 0)), X = Math.min(ot - 2, Math.max(0, q | 0));
      E[x] = X * ot + w, I[x] = Math.round(255 * Math.min(1, Math.max(0, Y - w))), g[x] = Math.round(255 * Math.min(1, Math.max(0, q - X)));
    }
  return S;
}
function he(t) {
  if (typeof OffscreenCanvas == "function") return new OffscreenCanvas(t, t);
  if (typeof document < "u") {
    const e = document.createElement("canvas");
    return e.width = e.height = t, e;
  }
  return null;
}
function le(t, e) {
  return t.getContext("2d", e ? { willReadFrequently: !0 } : void 0);
}
function ia(t, e) {
  const s = he(e), a = s && le(s, !0);
  if (!a) return null;
  const i = Ft / e;
  a.setTransform(1 / i, 0, 0, 1 / i, xt / i, xt / i), a.fillStyle = "#fff", a.fill(t);
  const o = a.getImageData(0, 0, e, e).data, r = new Uint8ClampedArray(e * e);
  for (let c = 0; c < e * e; c++) r[c] = o[c * 4 + 3];
  return r;
}
const Yt = /* @__PURE__ */ new Map(), ge = /* @__PURE__ */ new Set(), ze = /* @__PURE__ */ new WeakMap();
let oa = 0;
function je(t) {
  let e = ze.get(t);
  return e || ze.set(t, e = `p${oa++}`), e;
}
const Te = [];
let Pe = !1;
function Ue() {
  Pe = !1;
  const t = Te.shift();
  t && t(), Te.length && ws();
}
function ws() {
  if (Pe) return;
  Pe = !0;
  const t = globalThis.requestIdleCallback;
  t ? t(Ue, { timeout: 120 }) : setTimeout(Ue, 16);
}
function ra(t) {
  Te.push(t), ws();
}
function bs(t, e, s, a, i) {
  const o = `${t}|${s}|${Math.round(a)}`, r = Yt.get(o);
  if (r) return r;
  const c = () => {
    if (ge.delete(o), Yt.has(o)) return;
    const n = ia(e, s);
    n && (Yt.size >= 48 && Yt.clear(), Yt.set(o, na(n, s, a)));
  };
  return i ? (c(), Yt.get(o) ?? null) : (ge.has(o) || (ge.add(o), ra(c)), null);
}
function ca(t, e, s = 192, a = 0.65) {
  bs(t, e, ks(s), 15 * a, !0);
}
function ks(t) {
  return t <= 100 ? 64 : t <= 224 ? 96 : 128;
}
const Ae = (t) => t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4), Gt = /* @__PURE__ */ new Map();
function ha(t) {
  let e = Gt.get(t);
  if (!e) {
    let s = Fe(t);
    if (!s) {
      const a = he(1), i = a && le(a, !0);
      if (i) {
        i.fillStyle = t, i.fillRect(0, 0, 1, 1);
        const o = i.getImageData(0, 0, 1, 1).data;
        s = [o[0], o[1], o[2]];
      } else s = [128, 128, 128];
    }
    e = [Ae(s[0] / 255), Ae(s[1] / 255), Ae(s[2] / 255)], Gt.size > 200 && Gt.clear(), Gt.set(t, e);
  }
  return e;
}
const fe = 2048, xs = 2.5, Ss = fe / xs, Ts = new Float32Array(fe);
for (let t = 0; t < fe; t++) {
  const e = (t + 0.5) / Ss, s = e <= 0.75 ? e : 0.75 + 0.25 * (1 - Math.exp(-(e - 0.75) / 0.25));
  Ts[t] = 255 * (s <= 31308e-7 ? 12.92 * s : 1.055 * Math.pow(s, 1 / 2.4) - 0.055);
}
const we = (t) => Ts[t <= 0 ? 0 : t >= xs ? fe - 1 : t * Ss | 0], ie = 1024, Bt = /* @__PURE__ */ new Map();
function Qe(t) {
  let e = Bt.get(t);
  if (!e) {
    e = new Float32Array(ie + 1);
    for (let s = 0; s <= ie; s++) e[s] = Math.pow(s / ie, t);
    Bt.size > 16 && Bt.clear(), Bt.set(t, e);
  }
  return e;
}
const be = [0.92, 0.96, 1], ke = [1, 0.98, 0.95], Ps = (t, e, s) => {
  const a = s <= t ? 0 : s >= e ? 1 : (s - t) / (e - t);
  return a * a * (3 - 2 * a);
}, Je = (t, e, s) => 1 - Ps(t - e, t + e, s);
function la(t, e, s, a) {
  const { L: i, V: o, H: r, U: c, W: n, A: h, B: l } = s, d = Math.max(e[0], e[1], e[2], 0.05), m = [e[0] / d, e[1] / d, e[2] / d], p = Math.max(0.03, 0.3 - 0.15 * a.shadow), u = 0.15 + 0.14 * a.spread, A = 0.85, M = Math.min(90, Math.round(110 / Math.pow(a.spread, 1.3))), S = Math.max(2, Math.round(8 / a.spread)), E = Qe(M), I = Qe(S), g = 0.45 * a.highlight, T = 0.1 * a.highlight, P = 0.11 * a.highlight, W = 0.3 * a.rim, b = [p * m[0], p * m[1], p * m[2]];
  for (let C = 0; C < ot; C++)
    for (let $ = 0; $ < ot; $++) {
      let x = $ / (ot - 1) * 2 - 1, y = C / (ot - 1) * 2 - 1, v = x * x + y * y;
      if (v > 1.14) continue;
      if (v > 1) {
        const F = 1 / Math.sqrt(v);
        x *= F, y *= F, v = 1;
      }
      const L = Math.sqrt(1 - v), G = x * i[0] + y * i[1] + L * i[2], j = Math.max(0, x * o[0] + y * o[1] + L * o[2]), ft = Math.max(0, x * r[0] + y * r[1] + L * r[2]), R = Math.min(1, Math.max(0, (G + u) / (1 + u))), H = 1 - j, Z = H * H, B = Z * H, U = B * Z, N = ft * ie | 0, at = (g * E[N] + T * I[N]) * (1 + 3 * U), tt = 2 * j * x - o[0], Q = 2 * j * y - o[1], f = 2 * j * L - o[2], k = 0.45 + 0.55 * Ps(-0.4, 0.6, tt * c[0] + Q * c[1] + f * c[2]), Y = tt * n[0] + Q * n[1] + f * n[2];
      let q = 0;
      if (Y > 0.5) {
        const F = (tt * h[0] + Q * h[1] + f * h[2]) / Y, _ = (tt * l[0] + Q * l[1] + f * l[2]) / Y;
        q = Je(0.34, 0.12, Math.abs(F)) * Je(0.12, 0.06, Math.abs(_));
      }
      const w = W * B * k + P * q, X = (C * ot + $) * 3;
      t[X] = we(e[0] * (b[0] + A * R) + at * ke[0] + w * be[0]), t[X + 1] = we(e[1] * (b[1] + A * R) + at * ke[1] + w * be[1]), t[X + 2] = we(e[2] * (b[2] + A * R) + at * ke[2] + w * be[2]);
    }
}
function Ne(t, e, s, a) {
  const i = (e * 0.5 + 0.5) * (ot - 1), o = (s * 0.5 + 0.5) * (ot - 1), r = Math.min(ot - 2, Math.max(0, i | 0)), c = Math.min(ot - 2, Math.max(0, o | 0)), n = i - r, h = o - c, l = (c * ot + r) * 3, d = ot * 3, m = (1 - n) * (1 - h), p = n * (1 - h), u = (1 - n) * h, A = n * h;
  for (let M = 0; M < 3; M++) a[M] = t[l + M] * m + t[l + 3 + M] * p + t[l + d + M] * u + t[l + d + 3 + M] * A;
}
function fa(t, e, s, a) {
  const { N: i, i00: o, wx: r, wy: c, ao: n } = t, h = ot * 3;
  for (let l = 0, d = 0; l < i * i; l++, d += 4) {
    const m = n[l];
    if (m === 0) {
      s[d + 3] = 0;
      continue;
    }
    const p = a[m], u = o[l] * 3, A = r[l] * (1 / 255), M = c[l] * (1 / 255), S = (1 - A) * (1 - M) * p, E = A * (1 - M) * p, I = (1 - A) * M * p, g = A * M * p;
    s[d] = e[u] * S + e[u + 3] * E + e[u + h] * I + e[u + h + 3] * g, s[d + 1] = e[u + 1] * S + e[u + 4] * E + e[u + h + 1] * I + e[u + h + 4] * g, s[d + 2] = e[u + 2] * S + e[u + 5] * E + e[u + h + 2] * I + e[u + h + 5] * g, s[d + 3] = 255;
  }
}
const zt = (t) => {
  const e = Math.hypot(t[0], t[1], t[2]) || 1;
  return [t[0] / e, t[1] / e, t[2] / e];
};
function ua(t) {
  const e = Math.cos(t.roll), s = Math.sin(t.roll), a = e * t.lx + s * t.ly, i = -s * t.lx + e * t.ly, o = t.facing < 0 ? -1 : 1, r = o * Math.min(1, Math.abs(t.facing) / 0.16), { cy: c, sy: n, cp: h, sp: l } = t, d = ($, x, y, v = r) => zt([c * $ + n * l * x - n * h * y, h * x + l * y, v * (n * $ - c * l * x + c * h * y)]), m = d(Ke * a, Ke * i, Js), p = d(0, 0, 1, o), u = zt([m[0] + p[0], m[1] + p[1], m[2] + p[2]]), A = d(a, i, 0, o), M = Math.cos(80 * Math.PI / 180), S = Math.sin(80 * Math.PI / 180), E = M * a - S * i, I = S * a + M * i, g = zt([0.55 * E, 0.55 * I, 0.83]), T = zt([g[1], -g[0], 0]), P = [g[1] * T[2] - g[2] * T[1], g[2] * T[0] - g[0] * T[2], g[0] * T[1] - g[1] * T[0]], W = d(g[0], g[1], g[2], o), b = d(T[0], T[1], T[2], o), C = d(P[0], P[1], P[2], o);
  return { L: m, V: p, H: u, U: A, W, A: b, B: C };
}
const ts = /* @__PURE__ */ new WeakMap();
function da(t, e) {
  const s = t.canvas ?? t;
  let a = ts.get(s);
  a || (a = /* @__PURE__ */ new Map(), ts.set(s, a));
  let i = a.get(e);
  return i || (i = {
    N: 0,
    img: null,
    mc: new Float32Array(ne * 3),
    mcPrev: new Float32Array(ne * 3),
    mcMix: new Float32Array(ne * 3),
    mixVersion: 0,
    blendT: 1,
    blendFrames: 1,
    sinceBuild: 0,
    L: null,
    V: null,
    lx: NaN,
    ly: NaN,
    base: "",
    shadow: NaN,
    highlight: NaN,
    spread: NaN,
    rim: NaN,
    version: 0,
    imgVersion: -1,
    imgAoK: NaN,
    imgForm: null,
    aoK: -1,
    aoMul: new Float32Array(256),
    near: null,
    rimG: null,
    far: null,
    scratch: [null, null],
    scratchIdx: 0,
    scratchN: 0,
    scratchStale: !0,
    sprites: [null, null, null],
    spriteVersion: -1,
    spritePx: 0
  }, a.size > 4 && a.clear(), a.set(e, i)), i;
}
const xe = 1 / 48, es = (t, e) => !e || Math.abs(t[0] - e[0]) >= xe || Math.abs(t[1] - e[1]) >= xe || Math.abs(t[2] - e[2]) >= xe;
function ve(t, e) {
  return [
    t[0] * e[0] + t[2] * e[1],
    t[1] * e[0] + t[3] * e[1],
    t[0] * e[2] + t[2] * e[3],
    t[1] * e[2] + t[3] * e[3],
    t[0] * e[4] + t[2] * e[5] + t[4],
    t[1] * e[4] + t[3] * e[5] + t[5]
  ];
}
function jt(t, e, s, a, i) {
  const o = Math.sqrt(1 - s * s), r = [0, 0, 0], c = 1 - a;
  if (typeof t.createConicGradient == "function") {
    const l = t.createConicGradient(0, 50, 50);
    for (let d = 0; d <= Me; d++) {
      const m = d / Me * Math.PI * 2;
      Ne(e, o * Math.cos(m), o * Math.sin(m), r), l.addColorStop(d / Me, `rgb(${r[0] * c | 0} ${r[1] * c | 0} ${r[2] * c | 0})`);
    }
    return l;
  }
  const n = t.createLinearGradient(50 + i[0] * 50, 50 + i[1] * 50, 50 - i[0] * 50, 50 - i[1] * 50), h = (l, d, m) => {
    Ne(e, l, d, r), n.addColorStop(m, `rgb(${r[0] * c | 0} ${r[1] * c | 0} ${r[2] * c | 0})`);
  };
  return h(o * i[0], o * i[1], 0), h(-o * i[1], o * i[0], 0.5), h(-o * i[0], -o * i[1], 1), n;
}
const pa = typeof navigator < "u" && /AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent), ss = [[0.55, () => 0], [0, () => 0], [0, (t) => Math.min(0.6, 0.25 * t.shadow)]];
function ma(t, e, s, a, i, o) {
  const r = ks(s.dev), c = bs(e.typeKey ?? je(e.path), e.path, r, s.halfDepth, !!s.still);
  if (!c) return !1;
  const n = da(t, e.typeKey ?? je(e.path)), h = ua(s), l = (() => {
    const w = Math.hypot(h.L[0], h.L[1]);
    return w < 0.05 ? [0, -1] : [h.L[0] / w, h.L[1] / w];
  })();
  if ((es(h.L, n.L) || es(h.V, n.V) || s.lx !== n.lx || s.ly !== n.ly || a.base !== n.base || o.shadow !== n.shadow || o.highlight !== n.highlight || o.spread !== n.spread || o.rim !== n.rim) && (n.version > 0 && n.mcPrev.set(n.mcMix), la(n.mc, ha(a.base), h, o), n.version === 0 ? (n.mcMix.set(n.mc), n.blendT = 1) : (n.blendFrames = Math.min(10, Math.max(1, n.sinceBuild)), n.blendT = 0), n.sinceBuild = 0, n.mixVersion++, n.L = h.L, n.V = h.V, n.lx = s.lx, n.ly = s.ly, n.base = a.base, n.shadow = o.shadow, n.highlight = o.highlight, n.spread = o.spread, n.rim = o.rim, n.version++, n.near = n.rimG = n.far = null), n.sinceBuild++, n.blendT < 1) {
    n.blendT = Math.min(1, n.blendT + 1 / n.blendFrames);
    const w = n.blendT >= 1 ? 1 : n.blendT * n.blendT * (3 - 2 * n.blendT), X = n.mcPrev, F = n.mc, _ = n.mcMix;
    for (let O = 0; O < ne * 3; O++) _[O] = X[O] + (F[O] - X[O]) * w;
    n.mixVersion++;
  }
  const d = Math.min(1.3, 1.2 * o.shadow);
  if (d !== n.aoK) {
    for (let w = 0; w < 256; w++) n.aoMul[w] = Math.max(0, 1 - d * (1 - w / 255));
    n.aoK = d;
  }
  if ((!n.img || n.N !== r) && (n.img = new ImageData(r, r), n.N = r, n.imgVersion = -1), (n.imgVersion !== n.mixVersion || n.imgAoK !== d || n.imgForm !== c) && (fa(c, n.mcMix, n.img.data, n.aoMul), n.imgVersion = n.mixVersion, n.imgAoK = d, n.imgForm = c, n.scratchStale = !0), n.scratchN !== r && (n.scratch = [null, null], n.scratchN = r, n.scratchStale = !0), n.scratchStale) {
    n.scratchIdx ^= 1;
    let w = n.scratch[n.scratchIdx];
    if (!w) {
      const X = he(r), F = X && le(X, !1);
      if (!X || !F) return !1;
      w = n.scratch[n.scratchIdx] = { c: X, g: F };
    }
    w.g.putImageData(n.img, 0, 0), n.scratchStale = !1;
  }
  const m = n.scratch[n.scratchIdx];
  let p = e.sides === "sprite" || e.sides !== "vector" && pa;
  if (p) {
    const w = Math.ceil(Ft * s.dev / 100);
    if (n.spritePx !== w && (n.sprites = [null, null, null], n.spritePx = w, n.spriteVersion = -1), n.spriteVersion !== n.version) {
      const X = w / Ft;
      for (let F = 0; F < 3 && p; F++) {
        let _ = n.sprites[F];
        if (!_) {
          const O = he(w), V = O && le(O, !1);
          if (!O || !V) {
            p = !1;
            break;
          }
          _ = n.sprites[F] = { c: O, g: V };
        }
        _.g.setTransform(1, 0, 0, 1, 0, 0), _.g.clearRect(0, 0, w, w), _.g.setTransform(X, 0, 0, X, xt * X, xt * X), _.g.fillStyle = jt(_.g, n.mc, ss[F][0], ss[F][1](o), l), _.g.fill(e.path);
      }
      p && (n.spriteVersion = n.version);
    }
  }
  !p && !n.near && (n.near = jt(t, n.mc, 0.55, 0, l), n.rimG = jt(t, n.mc, 0, 0, l), n.far = jt(t, n.mc, 0, Math.min(0.6, 0.25 * o.shadow), l));
  const { cy: u, sy: A, cp: M, sp: S, halfDepth: E, cap: I } = s, g = s.facing >= 0 ? 1 : -1, [T, P, W, b, C, $] = s.ctm;
  let x = null;
  p && (t.imageSmoothingEnabled = !0, t.imageSmoothingQuality = "high");
  let y = 1, v = 0, L = 0, G = 1, j = 0, ft = 0;
  for (let w = 0; w < Ce - 1; w++) {
    const F = -1 + 2 * (g > 0 ? w : Ce - 1 - w) / (Ce - 1), _ = Ns(F, I), O = F * g, V = u * _, nt = A * S * _, rt = M * _, it = F * A * E - 50 * V, ht = -F * u * S * E - 50 * nt - 50 * rt, K = y * G - v * L, et = G / K, st = -v / K, lt = -L / K, Tt = y / K, yt = (L * ft - G * j) / K, gt = (v * j - y * ft) / K;
    t.transform(et * V + lt * nt, st * V + Tt * nt, lt * rt, Tt * rt, et * it + lt * ht + yt, st * it + Tt * ht + gt), y = V, v = nt, L = 0, G = rt, j = it, ft = ht;
    const pt = O > 0.4 ? 0 : O >= 0 ? 1 : 2;
    if (p)
      t.drawImage(n.sprites[pt].c, -xt, -xt, Ft, Ft);
    else {
      const At = pt === 0 ? n.near : pt === 1 ? n.rimG : n.far;
      At !== x && (t.fillStyle = x = At), t.fill(e.path);
    }
  }
  t.setTransform(T, P, W, b, C, $);
  const R = 1 / (u * M), H = A * E / u, Z = -S * E * R, B = Math.hypot(H, Z), U = B > 1e-6 ? g * H / B : 1, N = B > 1e-6 ? g * Z / B : 0, at = 50 * I + Math.hypot(50 * (1 - I), B), tt = (at + 50) / 100, Q = (at - 50) / 2, f = 1 + (tt - 1) * U * U, k = (tt - 1) * U * N, Y = 1 + (tt - 1) * N * N, q = ve(ve(s.ctm, [u, A * S, 0, M, 0, 0]), [f, k, k, Y, Q * U - 50 * f - 50 * k, Q * N - 50 * k - 50 * Y]);
  if (t.save(), t.setTransform(q[0], q[1], q[2], q[3], q[4], q[5]), t.clip(e.path), t.imageSmoothingEnabled = !0, t.imageSmoothingQuality = "high", t.drawImage(m.c, -xt, -xt, Ft, Ft), t.restore(), s.dev >= 256 && o.rim > 0 && o.highlight > 0) {
    t.save(), t.globalCompositeOperation = "source-atop", t.setTransform(q[0], q[1], q[2], q[3], q[4], q[5]);
    const w = Math.min(0.5, 0.3 * o.rim * Math.min(1.4, o.highlight)), X = t.createLinearGradient(50 + l[0] * 50, 50 + l[1] * 50, 50 - l[0] * 50, 50 - l[1] * 50);
    X.addColorStop(0, `rgba(235,244,255,${w.toFixed(3)})`), X.addColorStop(0.45, `rgba(235,244,255,${(0.35 * w).toFixed(3)})`), X.addColorStop(0.75, "rgba(235,244,255,0)"), t.strokeStyle = X, t.lineJoin = "round", t.lineWidth = 1.3, t.stroke(e.path), t.restore();
  }
  return !0;
}
const kt = 1.5, oe = 0.1, It = 17, Ma = 15, Ca = 0.9, as = (t, e) => e + (1 - e) * Math.sqrt(Math.max(0, 1 - t * t)), ya = 25, ga = 6.3, Aa = { eyes: 1, mouth: -3.5 }, Ut = /* @__PURE__ */ new Map();
function wa(t, e, s) {
  const a = `${t}|${e}|${s}`;
  let i = Ut.get(a);
  if (!i) {
    const o = mt(t, -0.3 * e, 0.05 * e), r = mt(t, -0.12 * e, 0.03 * e), c = [], n = [];
    for (let h = 0; h < It; h++) {
      const l = h / (It - 1);
      c.push(l > 0.6 ? "" : is(o, r, l / 0.6)), n.push(l >= 0.5 ? t : is(o, t, l / 0.5));
    }
    i = {
      base: t,
      far: o,
      near: r,
      light: mt(t, 0.04 * s),
      dark: mt(t, -0.3 * e, 0.05 * e),
      capTop: mt(t, 0.035 * s),
      capBottom: mt(t, -0.035 * e),
      crispMix: c,
      smoothMix: n,
      grad: null
    }, Ut.size > 200 && Ut.clear(), Ut.set(a, i);
  }
  return i;
}
const ns = (t) => (t.startsWith("hsl(") ? t : mt(t, 0)).match(/[\d.]+/g).map(Number);
function is(t, e, s) {
  const a = ns(t), i = ns(e), o = a.map((r, c) => r + (i[c] - r) * s);
  return `hsl(${o[0].toFixed(1)} ${o[1].toFixed(1)}% ${o[2].toFixed(1)}%)`;
}
const Xt = 34, ba = Math.PI * 1.55, ka = 57, xa = 0.4, os = -0.28, Qt = /* @__PURE__ */ new Map();
function Sa(t) {
  let e = Qt.get(t);
  return e || (e = { base: mt(t, 0.1, 0.02), light: mt(t, 0.3, 0.04), dark: mt(t, -0.22, 0.08), halo: mt(t, 0.2) }, Qt.size > 200 && Qt.clear(), Qt.set(t, e)), e;
}
const Jt = (t, e) => t.replace(")", ` / ${Math.max(0, Math.min(1, e)).toFixed(3)})`);
function rs(t, e, s, a, i, o, r) {
  const c = (r == null ? void 0 : r.strength) ?? 0, n = Math.min(1, e.whirl * c);
  if (n <= 0.01) return;
  const h = (r == null ? void 0 : r.size) ?? 1, l = (r == null ? void 0 : r.width) ?? 1, d = (r == null ? void 0 : r.length) ?? 1, m = (r == null ? void 0 : r.tilt) ?? 1, p = ba * d, u = Sa(s), A = -e.whirlAngle, M = ka * h, S = M * xa * m * (o ? 1.14 : 0.86), E = Math.atan2(i, a) - os;
  t.save(), t.rotate(os), t.translate(0, 5), t.lineCap = "butt";
  const I = (g, T, P, W, b) => {
    t.strokeStyle = W, t.lineWidth = P, t.beginPath(), t.ellipse(0, b, M, S, 0, g, T, !1), t.stroke();
  };
  if (o)
    for (let g = 0; g < Xt; g++) {
      const T = g / Xt, P = A + T * p, W = P + p / Xt + 0.012;
      if (Math.sin((W + P) / 2) <= 0) continue;
      const b = Math.pow(1 - T, 1.3);
      I(P, W, (2 + 8 * b) * 1.5 * l, `rgba(0,0,0,${(0.2 * n * b).toFixed(3)})`, 3.5);
    }
  for (let g = 0; g < Xt; g++) {
    const T = g / Xt, P = A + T * p, W = P + p / Xt + 0.012, b = (W + P) / 2;
    if (Math.sin(b) > 0 !== o) continue;
    const C = 0.6 + 0.4 * Math.sin(b), $ = Math.pow(1 - T, 1.3), x = 1 + 0.18 * Math.sin(T * 9 + 1.2), y = (2 + 8 * $) * C * l * x, v = n * (0.3 + 0.7 * $) * C, L = 0.5 + 0.5 * Math.cos(b - E);
    I(P, W, y * 2.6, Jt(u.halo, v * 0.2), 0), I(P, W, y * 0.8, Jt(u.dark, v * 0.45), y * 0.32), I(P, W, y, Jt(u.base, v * 0.72), 0), I(P, W, y * 0.62, Jt(u.light, v * 0.78 * (0.4 + 0.6 * L)), -y * 0.16), I(P, W, y * 0.24, `rgba(255,255,255,${(v * 0.9 * (0.15 + 0.85 * L * L)).toFixed(3)})`, -y * 0.3);
  }
  t.restore();
}
function cs(t, e, s, a) {
  const i = e * kt;
  t.clearRect(0, 0, i, i);
  const o = e / 100;
  let r, c;
  if (a.dpr !== void 0)
    r = a.dpr, c = [r, 0, 0, r, 0, 0];
  else if (t.getTransform) {
    const R = t.getTransform();
    c = [R.a, R.b, R.c, R.d, R.e, R.f], r = R.a || 1;
  } else
    r = 1, c = [1, 0, 0, 1, 0, 0];
  const n = a.shadow ?? 0.35, h = a.highlight ?? 1.3, l = Ma * (a.depth ?? 0.65), d = 1 - (1 - Ca) * (a.rim ?? 0.5), m = a.spread ?? 1.55, p = (a.light ?? 265) * Math.PI / 180, u = Math.sin(p), A = -Math.cos(p), M = wa(a.color, n, h), S = Math.cos(s.yaw), E = Math.sin(s.yaw), I = Math.cos(s.pitch), g = Math.sin(s.pitch), T = S * I, P = (R) => Math.abs(R) < 0.22 ? R < 0 ? -0.22 : 0.22 : R, W = P(S), b = P(I), C = Math.cos(s.roll), $ = Math.sin(s.roll), x = s.sx * o, y = s.sy * o, v = 50 * (1 - s.sy) * o, L = ve(c, [C * x, $ * x, -$ * y, C * y, i / 2 + s.x * o - $ * v, i / 2 + oe * e + s.y * o + C * v]);
  t.save(), t.setTransform(L[0], L[1], L[2], L[3], L[4], L[5]), t.lineCap = "round", t.lineJoin = "round";
  const G = a.shading, j = (R, H, Z) => {
    let B = M.near, U = M.base;
    if (G === "crisp") {
      if (!M.grad || M.grad.lx !== u || M.grad.ly !== A) {
        const K = t.createLinearGradient(u * 56, A * 56, -u * 56, -A * 56);
        K.addColorStop(0, M.light), K.addColorStop(0.45, M.near), K.addColorStop(1, M.dark);
        const et = t.createLinearGradient(u * 46, A * 46, -u * 46, -A * 46);
        et.addColorStop(0, M.capTop), et.addColorStop(1, M.capBottom), M.grad = { lx: u, ly: A, lit: K, cap: et };
      }
      B = M.grad.lit, U = M.grad.cap;
    }
    let N = !1;
    G === "plastic" && (N = ma(
      t,
      { ...a, path: R, typeKey: H },
      { cy: W, sy: E, cp: b, sp: g, facing: T, roll: s.roll, halfDepth: Z, cap: d, lx: u, ly: A, dev: e * r, ctm: L, still: a.still },
      M,
      null,
      { shadow: n, highlight: h, spread: m, rim: a.rim ?? 0.5 }
    ));
    const at = G === "plastic" && !N ? "smooth" : G, tt = at === "smooth", Q = tt && typeof Path2D == "function" ? new Path2D() : null, f = T >= 0 ? 1 : -1, [k, Y, q, w, X, F] = L;
    let _ = null, O = 1, V = 0, nt = 0, rt = 1, it = 0, ht = 0;
    for (let K = 0; K < It && !N; K++) {
      const st = -1 + 2 * (f > 0 ? K : It - 1 - K) / (It - 1), lt = as(st, d), Tt = K / (It - 1), yt = W * lt, gt = E * g * lt, pt = b * lt, At = st * E * Z - 50 * yt, bt = -st * W * g * Z - 50 * gt - 50 * pt, Mt = O * rt - V * nt, Ot = rt / Mt, Ht = -V / Mt, D = -nt / Mt, z = O / Mt, J = (nt * ht - rt * it) / Mt, ut = (V * it - O * ht) / Mt;
      t.transform(Ot * yt + D * gt, Ht * yt + z * gt, D * pt, z * pt, Ot * At + D * bt + J, Ht * At + z * bt + ut), O = yt, V = gt, nt = 0, rt = pt, it = At, ht = bt;
      let dt;
      tt ? dt = M.smoothMix[K] : K === It - 1 ? dt = U : Tt > 0.6 ? dt = B : dt = M.crispMix[K], dt !== _ && (t.fillStyle = _ = dt), t.fill(R), Q && Q.addPath(R, { a: yt, b: gt, c: 0, d: pt, e: At, f: bt });
    }
    if (N || t.setTransform(k, Y, q, w, X, F), Q && at === "smooth") {
      t.save(), t.clip(Q);
      const K = Math.min(1, 0.34 * n), et = t.createRadialGradient(-u * 45, -A * 45, 4 * m, -u * 45, -A * 45, 84 * m);
      et.addColorStop(0, `rgba(0,0,0,${K})`), et.addColorStop(0.5, `rgba(0,0,0,${K * 0.35})`), et.addColorStop(1, "rgba(0,0,0,0)"), t.globalCompositeOperation = "multiply", t.fillStyle = et, t.fillRect(-120, -120, 240, 240), t.globalCompositeOperation = "source-over";
      const st = Math.min(1, 0.22 * h), lt = t.createRadialGradient(u * 37, A * 37, 0, u * 37, A * 37, 62 * m);
      lt.addColorStop(0, `rgba(255,255,255,${st})`), lt.addColorStop(0.6, `rgba(255,255,255,${st * 0.23})`), lt.addColorStop(1, "rgba(255,255,255,0)"), t.fillStyle = lt, t.fillRect(-120, -120, 240, 240), t.restore();
    }
    return N;
  };
  rs(t, s, a.color, u, A, !1, a.whirl), a.parts && j(a.parts, `${a.typeKey ?? "custom"}:parts`, l * (a.partsDepth ?? 0.4));
  const ft = j(a.path, a.typeKey ?? "custom", l);
  if (T > -0.2) {
    t.save();
    {
      const R = T >= 0 ? 1 : -1, H = as(R, d), Z = W * H, B = E * g * H, U = b * H, N = R * E * l - 50 * Z, at = -R * W * g * l - 50 * B - 50 * U, [tt, Q, f, k, Y, q] = L;
      t.setTransform(tt * Z + f * B, Q * Z + k * B, f * U, k * U, tt * N + f * at + Y, Q * N + k * at + q), t.clip(a.path), t.setTransform(tt, Q, f, k, Y, q);
    }
    t.translate(a.faceX - 50, a.faceY - 50), t.scale(a.faceScale, a.faceScale), ft && (t.globalAlpha = 0.93), Fa(t, s, a), t.restore();
  }
  rs(t, s, a.color, u, A, !0, a.whirl), t.restore();
}
const Nt = 30;
function Ta(t, e, s, a) {
  const i = Math.asin(Math.max(-1, Math.min(1, t / Nt))) + s, o = Math.asin(Math.max(-1, Math.min(1, -e / Nt))) + a, r = Math.cos(o);
  return {
    x: Nt * Math.sin(i) * r,
    y: -Nt * Math.sin(o),
    sx: Math.cos(i),
    sy: r,
    z: Math.cos(i) * r
  };
}
const hs = 8, te = /* @__PURE__ */ new Map();
function Pa(t, e, s) {
  const a = Math.round(t * 50), i = Math.round(e * 50), o = Math.round(s * 50), r = a + 2e3 * i + 4e6 * o;
  let c = te.get(r);
  if (!c) {
    const n = a / 50, h = i / 50, l = o / 50;
    let d = `M${-n} ${h}`;
    for (let m = 1; m <= hs; m++) {
      const p = m / hs, u = 1 - p;
      d += ` L${(u * u * -n + p * p * n).toFixed(3)} ${((u * u + p * p) * h + 2 * u * p * l).toFixed(3)}`;
    }
    c = new Path2D(d), te.size > 256 && te.clear(), te.set(r, c);
  }
  return c;
}
const ls = Math.sin(0.684), fs = Math.cos(0.684), ee = /* @__PURE__ */ new Map();
function va(t) {
  const e = (b) => Math.round(b * 50) / 50, s = e(t.hw), a = e(t.t0), i = e(t.a), o = e(t.yt), r = e(t.ab), c = e(t.yb), n = `${s},${a},${i},${o},${r},${c}`;
  let h = ee.get(n);
  if (h) return h;
  const l = (b) => b.toFixed(3), d = a * ls, m = a * fs, p = -s + d, u = -m, A = s - d, M = -m, S = -s - d, E = m, I = s + d, g = m, T = 4 / 3 * a * fs, P = 4 / 3 * a * ls, W = `M${l(p)} ${l(u)}C${l(-s + i * s)} ${l(o - a)} ${l(s - i * s)} ${l(o - a)} ${l(A)} ${l(M)}C${l(A + T)} ${l(M - P)} ${l(I + T)} ${l(g - P)} ${l(I)} ${l(g)}C${l(s - r * s)} ${l(c + a)} ${l(-s + r * s)} ${l(c + a)} ${l(S)} ${l(E)}C${l(S - T)} ${l(E - P)} ${l(p - T)} ${l(u - P)} ${l(p)} ${l(u)}Z`;
  return h = new Path2D(W), ee.size > 256 && ee.clear(), ee.set(n, h), h;
}
function Fa(t, e, s) {
  // DEX: the library's projector (places a feature on the head, foreshortened
  // with its yaw and pitch, faded as it turns away), then the expressive face.
  const { yaw: d, pitch: m } = e, p = (b, C, $, x = 1) => {
    const y = Ta(b, C, d, m);
    y.z <= 0.02 || x <= 0.01 || (t.save(), t.globalAlpha = x * Math.min(1, y.z * 5), t.translate(y.x, y.y), t.scale(Math.max(0.02, y.sx), Math.max(0.02, y.sy)), $(), t.restore());
  };
  drawExpressiveFace(t, e, s, p);
}
const St = { x: NaN, y: NaN }, qt = /* @__PURE__ */ new Set();
let wt = 0, re = 0;
function vs(t) {
  wt = 0;
  const e = re ? Math.min(0.1, (t - re) / 1e3) : 0;
  re = t, qt.forEach((s) => s(e)), qt.size && (wt = requestAnimationFrame(vs));
}
function Fs() {
  wt || typeof document > "u" || document.hidden || (re = 0, wt = requestAnimationFrame(vs));
}
let us = !1;
function La() {
  us || typeof document > "u" || (us = !0, document.addEventListener("pointermove", (t) => {
    St.x = t.clientX, St.y = t.clientY;
  }, { passive: !0 }), document.addEventListener("pointerleave", () => {
    St.x = NaN, St.y = NaN;
  }), window.addEventListener("blur", () => {
    St.x = NaN, St.y = NaN;
  }), document.addEventListener("visibilitychange", () => {
    document.hidden ? (wt && cancelAnimationFrame(wt), wt = 0) : qt.size && Fs();
  }));
}
function Ea(t) {
  return La(), qt.add(t), Fs(), () => {
    qt.delete(t), !qt.size && wt && (cancelAnimationFrame(wt), wt = 0);
  };
}
function Ia(t) {
  let e = 2166136261;
  for (let s = 0; s < t.length; s++) e = Math.imul(e ^ t.charCodeAt(s), 16777619);
  return (e >>> 0) % 1e3 / 1e3;
}
const Ct = (t, e, s) => Math.min(s, Math.max(e, Number.isFinite(t) ? t : 1)), ds = /* @__PURE__ */ new Map();
function ps(t) {
  let e = ds.get(t);
  return e || (e = new Path2D(t), ds.set(t, e)), e;
}
const Se = () => typeof matchMedia == "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, _a = Is(function({
  type: e = "clover",
  face: s,
  state: a = "default",
  size: i = 64,
  color: o,
  ink: r,
  brightness: c = 1,
  saturation: n = 1.5,
  speed: h = 1,
  paused: l = !1,
  seed: d,
  shading: m = "plastic",
  shadow: p = 0.35,
  highlight: u = 1.3,
  depth: A = 0.65,
  light: M = 265,
  rim: S = 0.5,
  spread: E = 1.55,
  interactive: I = !0,
  turn: g = 1,
  theme: T = "auto",
  whirl: P = 0,
  whirlSize: W = 1,
  whirlWidth: b = 1,
  whirlLength: C = 1,
  whirlTilt: $ = 1,
  jumpHeight: x = 26,
  jumpTime: y = 0.68,
  jumpStretch: v = 1,
  jumpSpin: L = 1,
  jumpLean: G = 6,
  jumpEvery: j = 8,
  jumpLand: ft = 0,
  jumpSquash: R = 1.15,
  jumpSquashTime: H = 0.37,
  jumpSquashEase: Z = "pulse",
  jumpGroundTime: B = 0.11,
  jumpGroundEase: U = "pulse",
  jumpRiseTime: N = 0.33,
  jumpRiseEase: at = "pulse",
  jumpClickSquashTime: tt = 0.24,
  // DEX: which expression the face wears (expressions.ts).
  expression: dexExpression,
  className: Q,
  style: f,
  "aria-label": k,
  ...Y
}, q) {
  const w = $t(null);
  $s(q, () => w.current);
  const X = Ys(), F = ce[e] ?? ce.clover, _ = s ?? F.face, O = o ?? F.color, V = c === 1 && n === 1 ? O : mt(O, (Math.min(2, Math.max(0, c)) - 1) * 0.35, (Math.min(2, Math.max(0, n)) - 1) * 0.5), nt = r ?? Ds(V), rt = Math.min(1, Math.max(0, d ?? Ia(X))), it = a in $e ? a : "default", ht = l || !(h > 0), K = m === !0 ? "crisp" : m === !1 ? "flat" : m, et = $t(null), st = $t(null), lt = $t(0), Tt = $t(h);
  Tt.current = h;
  const yt = $t(I);
  // DEX: the face eases between expressions; its numbers live per instance.
  const dexFace = $t(null);
  dexFace.current || (dexFace.current = {});
  yt.current = I, st.current = {
    expression: dexExpression,
    faceState: dexFace.current,
    path: typeof Path2D > "u" ? null : ps(Ye[e] ?? Ye.clover),
    face: _,
    faceX: F.faceX,
    faceY: F.faceY,
    faceScale: F.faceScale,
    color: V,
    ink: nt,
    shading: K,
    shadow: Ct(p, 0, 2),
    highlight: Ct(u, 0, 2),
    depth: Ct(A, 0.2, 2),
    light: M,
    rim: Ct(S, 0, 2),
    spread: Ct(E, 0.4, 2.5),
    typeKey: e,
    still: ht || Se(),
    whirl: { strength: Ct(P, 0, 2), size: Ct(W, 0.6, 1.6), width: Ct(b, 0.4, 2), length: Ct(C, 0.4, 1.6), tilt: Ct($, 0.5, 1.8) },
    parts: typeof Path2D < "u" && Xe[e] ? ps(Xe[e]) : void 0
  };
  const gt = (D) => {
    if (T !== "auto") return T;
    const z = D == null ? void 0 : D.closest("[data-theme], .dark, .light");
    if (z) {
      const J = z.getAttribute("data-theme");
      if (J === "dark" || J === "light") return J;
      if (z.classList.contains("dark")) return "dark";
      if (z.classList.contains("light")) return "light";
    }
    return typeof matchMedia == "function" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }, pt = () => {
    const D = w.current, z = st.current;
    if (!D || !z || !z.path) return;
    const J = D.clientWidth / kt || lt.current || (typeof i == "number" ? i : 64);
    if (!J) return;
    const ut = Math.min(2, typeof devicePixelRatio == "number" && devicePixelRatio || 1), dt = Math.round(J * kt * ut);
    (D.width !== dt || D.height !== dt) && (D.width = dt, D.height = dt), lt.current = J;
    const Pt = D.getContext("2d");
    if (!Pt) return;
    Pt.setTransform(ut, 0, 0, ut, 0, 0), z.dpr = ut;
    const Vt = et.current ? et.current.pose : Ve(it);
    cs(Pt, J, Vt, z);
  };
  Xs(() => {
    if (et.current ? et.current.setState(it) : et.current = new Us(rt, it), et.current.setTurn(Ct(g, 0, 2)), et.current.setJump({ height: x, time: Math.max(0.2, y), stretch: v, spin: Math.max(0, Math.round(L)), lean: G, every: j, land: ft, squash: R, squashTime: Math.max(0.05, H), squashEase: Z, groundTime: Math.max(0, B), groundEase: U, riseTime: Math.max(0.05, N), riseEase: at, clickSquashTime: Math.max(0.05, tt) }), Se()) {
      const D = w.current;
      if (D && st.current && st.current.path) {
        const z = D.clientWidth / kt || lt.current || (typeof i == "number" ? i : 64);
        if (!z) return;
        lt.current = z;
        const J = Math.min(2, typeof devicePixelRatio == "number" && devicePixelRatio || 1);
        D.width = D.height = Math.round(z * kt * J);
        const ut = D.getContext("2d");
        ut && (st.current.theme = gt(D), st.current.dpr = J, ut.setTransform(J, 0, 0, J, 0, 0), cs(ut, z, Ve(it), st.current));
      }
      return;
    }
    st.current && w.current && (st.current.theme = gt(w.current)), pt();
  }), Ie(() => {
    var dt;
    if (K !== "plastic" || !((dt = st.current) != null && dt.path)) return;
    const D = st.current.path, z = (typeof i == "number" ? i : 64) * Math.min(2, typeof devicePixelRatio == "number" && devicePixelRatio || 1), ut = (typeof requestIdleCallback == "function" ? requestIdleCallback : (Pt) => setTimeout(Pt, 1))(() => ca(e, D, z, A));
    return () => {
      typeof cancelIdleCallback == "function" ? cancelIdleCallback(ut) : clearTimeout(ut);
    };
  }, [K, e, i, A]), Ie(() => {
    if (ht || Se()) return;
    const D = w.current;
    if (!D) return;
    let z = !0, J = null;
    const ut = 3, dt = (ue) => {
      const Lt = et.current;
      if (Lt) {
        if (yt.current && !Number.isNaN(St.x)) {
          const Rt = D.getBoundingClientRect(), de = Rt.width / kt || 1, Le = (St.x - (Rt.left + Rt.width / 2)) / de, Ee = (St.y - (Rt.top + Rt.height / 2 + oe * de)) / de, Wt = Math.hypot(Le, Ee), Ls = Wt < 1 ? 1 : Wt > ut ? 0 : 1 - (Wt - 1) / (ut - 1);
          Lt.setPointer(Le / Math.max(1, Wt), Ee / Math.max(1, Wt), Ls);
        } else Lt.setPointer(0, 0, 0);
        Lt.update(ue * Tt.current), pt();
      }
    }, Pt = () => {
      J || (J = Ea(dt));
    }, Vt = () => {
      J && J(), J = null;
    };
    let Kt = null;
    return typeof IntersectionObserver == "function" ? (Kt = new IntersectionObserver((ue) => {
      var Lt;
      z = ((Lt = ue[0]) == null ? void 0 : Lt.isIntersecting) ?? !0, z ? Pt() : Vt();
    }), Kt.observe(D)) : Pt(), () => {
      Vt(), Kt && Kt.disconnect();
    };
  }, [ht]);
  const At = typeof i == "number" ? `${i * kt}px` : `calc(${i} * ${kt})`, bt = (D) => typeof i == "number" ? `${-i * D}px` : `calc(${i} * ${-D})`, Mt = (kt - 1) / 2, Ot = {
    display: "inline-block",
    verticalAlign: "middle",
    width: At,
    height: At,
    marginLeft: bt(Mt),
    marginRight: bt(Mt),
    marginTop: bt(Mt + oe),
    marginBottom: bt(Mt - oe),
    flex: "none",
    ...f
  }, Ht = (D) => {
    var z, J;
    I && !ht && ((z = et.current) == null || z.poke()), (J = Y.onClick) == null || J.call(Y, D);
  };
  return /* @__PURE__ */ Es(
    "canvas",
    {
      ref: w,
      className: Q ? `ba ${Q}` : "ba",
      "data-bot-avatar": e,
      "data-face": _,
      "data-state": it,
      "data-expression": dexExpression,
      role: "img",
      "aria-label": k ?? `${F.label} bot, ${$e[it]}`,
      style: Ot,
      ...Y,
      onClick: Ht
    }
  );
});
export {
  Wa as BOT_AVATAR_MATCAP_SIZE,
  kt as BOT_AVATAR_OVERSCAN,
  xt as BOT_AVATAR_PAD,
  oe as BOT_AVATAR_RISE,
  Ft as BOT_AVATAR_SPAN,
  _a as BotAvatar,
  Us as BotAvatarSim,
  Ds as autoInk,
  na as bakeBotAvatarForm,
  ua as botAvatarCapFrame,
  Xa as botAvatarFaces,
  Re as botAvatarJumpDefaults,
  Ra as botAvatarPalette,
  Xe as botAvatarParts,
  ce as botAvatarPresets,
  Ye as botAvatarShapes,
  qa as botAvatarStates,
  ks as botAvatarTier,
  qs as botAvatarTypes,
  la as buildBotAvatarMatcap,
  _a as default,
  cs as drawBotAvatarFrame,
  Rs as luminance,
  Fe as parseColor,
  Ve as restPose,
  mt as shade,
  fa as shadeBotAvatarTexels,
  ca as warmBotAvatarPlastic
};
