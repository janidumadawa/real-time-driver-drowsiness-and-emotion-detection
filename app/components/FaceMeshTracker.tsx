"use client";

import { useEffect, useRef } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

const EAR_THRESHOLD = 0.25; //below this = eyes closed
const DROWSY_TIME_MS = 500; // 1 second
const BLINK_TIME_MS = 300; //300 ms , max duration for a blink
const MAX_BLINKS_PER_MIN = 35; // more than this = drowsy

function distance(a: any, b: any) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function FaceMeshTracker() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const alarmRef = useRef<HTMLAudioElement | null>(null);

  const mouthOffsetBuffer = useRef<number[]>([]);

  useEffect(() => {
    let faceLandmarker: FaceLandmarker;
    let animationId: number;

    const setup = async () => {
      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );

      faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });

      const render = () => {
        if (video.readyState === 4) {
          const results = faceLandmarker.detectForVideo(
            video,
            performance.now()
          );

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          //save and flip context for mirror view
          ctx.save();
          ctx.scale(-1, 1);
          ctx.translate(-canvas.width, 0);

          // Variables to store for text drawing
          let ear = 0;
          let emotion = "Neutral";
          let eyeStatus = "Eyes: Open";
          let drowsyWarning = false;

          // render loop for face landmarks
          if (results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];

            const leftEAR =
              distance(landmarks[159], landmarks[145]) /
              distance(landmarks[33], landmarks[133]);

            const rightEAR =
              distance(landmarks[386], landmarks[374]) /
              distance(landmarks[362], landmarks[263]);

            ear = (leftEAR + rightEAR) / 2.0;
            eyeStatus = ear < EAR_THRESHOLD ? "Eyes: Closed" : "Eyes: Open";

            //mouth emotion logic
            const leftCorner = landmarks[61];
            const rightCorner = landmarks[291];
            const topLip = landmarks[13];
            const bottomLip = landmarks[14];

            const mouthCenterY = (topLip.y + bottomLip.y) / 2;
            const leftOffset = mouthCenterY - leftCorner.y;
            const rightOffset = mouthCenterY - rightCorner.y;
            const avgOffset = (leftOffset + rightOffset) / 2;

            // smoothing
            mouthOffsetBuffer.current.push(avgOffset);
            if (mouthOffsetBuffer.current.length > 5)
              mouthOffsetBuffer.current.shift();
            const smoothOffset =
              mouthOffsetBuffer.current.reduce((a, b) => a + b, 0) /
              mouthOffsetBuffer.current.length;

            // determine emotion
            const thresholdUp = 0.015; // corners up -- happy
            const thresholdDown = -0.015; // corners down -- sad

            if (smoothOffset > thresholdUp) emotion = "Happy";
            else if (smoothOffset < thresholdDown) emotion = "Sad";

            const now = performance.now();

            // Eye closed logic
            if (ear < EAR_THRESHOLD) {
              if (eyeClosedStart.current === null) {
                eyeClosedStart.current = now;
              } else if (
                now - eyeClosedStart.current > DROWSY_TIME_MS &&
                !isDrowsy.current
              ) {
                isDrowsy.current = true;
              }
            } else {
              eyeClosedStart.current = null;
              isDrowsy.current = false;
            }

            //blink detection logic
            if (ear < EAR_THRESHOLD) {
              if (lastBlinkTime.current === null) {
                lastBlinkTime.current = now;
              }
            } else {
              if (
                lastBlinkTime.current !== null &&
                now - lastBlinkTime.current < BLINK_TIME_MS
              ) {
                blinkCount.current += 1;
              }
              lastBlinkTime.current = null;
            }

            //reset blink count every minute
            if (now - minuteStart.current > 60000) {
              blinkCount.current = 0;
              minuteStart.current = now;
            }

            if (isDrowsy.current) {
              alarmRef.current?.play();
              drowsyWarning = true;
            } else {
              alarmRef.current?.pause();
              if (alarmRef.current) alarmRef.current.currentTime = 0;
            }

            //draw eye points
            const eyePoints = [
              33, 133, 160, 159, 158, 157, 173, 144, 145, 153, 154, 155, 246,
              362, 263, 387, 386, 385, 384, 398, 373, 374, 380, 381, 382, 466,
            ];

            eyePoints.forEach((i) => {
              const p = landmarks[i];
              ctx.beginPath();
              ctx.arc(
                p.x * canvas.width,
                p.y * canvas.height,
                3,
                0,
                2 * Math.PI
              );
              ctx.fillStyle = "red";
              ctx.fill();
            });

            // Draw mouth points
            [leftCorner, rightCorner, topLip, bottomLip].forEach((p) => {
              ctx.beginPath();
              ctx.arc(
                p.x * canvas.width,
                p.y * canvas.height,
                4,
                0,
                2 * Math.PI
              );
              ctx.fillStyle = "blue";
              ctx.fill();
            });

            if (blinkCount.current > MAX_BLINKS_PER_MIN) {
              isDrowsy.current = true;
              drowsyWarning = true;
            }
          }

          ctx.restore(); //restore context (unmirrors for text)

          if (results.faceLandmarks.length > 0) {
            // Draw EAR and status text
            ctx.fillStyle = isDrowsy.current ? "red" : "green";
            ctx.font = "20px Arial";
            ctx.fillText(`EAR: ${ear.toFixed(2)}`, 20, 30);
            ctx.fillText(`Blinks/min: ${blinkCount.current}`, 20, 60);
            ctx.fillText(eyeStatus, 20, 90);

            // Draw emotion text
            ctx.fillStyle = "black";
            ctx.font = "20px Arial";
            ctx.fillText(`Emotion: ${emotion}`, 20, 150);

            // Draw drowsiness warning
            if (drowsyWarning) {
              const warningY = canvas.height - 80; // Bottom position
              const warningHeight = 60;

              // Draw background rectangle for warning
              ctx.fillStyle = "rgba(220, 38, 38, 0.8)";
              ctx.fillRect(10, warningY, canvas.width - 20, warningHeight);

              ctx.fillStyle = "#FFFFFF";
              ctx.font = "bold 28px Arial";
              ctx.fillText("⚠️ DROWSINESS DETECTED!", 80, warningY + 40);
            }
          } else {
            // No face detected text
            ctx.fillStyle = "gray";
            ctx.font = "20px Arial";
            ctx.fillText("No face detected", 20, 30);
          }

          animationId = requestAnimationFrame(render);
        }
      };

      alarmRef.current = new Audio("/alarm.wav");
      alarmRef.current.loop = true;

      render();
    };

    setup();

    return () => {
      cancelAnimationFrame(animationId);
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const eyeClosedStart = useRef<number | null>(null);
  const isDrowsy = useRef(false);

  const blinkCount = useRef(0);
  const lastBlinkTime = useRef<number | null>(null);
  const minuteStart = useRef(performance.now());
  //use useRef because this updates every frame.

  return (
    <div className="min-h-screen bg-gray-900 p-4 flex flex-col items-center justify-center">
      <h1 className="text-3xl font-bold text-white mb-4">Face Tracking</h1>

            {/* Square container with fixed aspect ratio */}
            <div
              className="relative"
              style={{ width: "640px", height: "480px" }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="absolute top-0 left-0 w-full h-full object-cover scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full"
              />
            </div>
          </div>
    
  );
}
