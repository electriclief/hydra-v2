@echo off
REM Qwen-Image-2.1 API server launcher for the hydra-local instance (node 123).
REM Mirrors Start_Image_API.bat: sd-server on :1234, model loaded once, WebUI at /
cd /d C:\Users\User\Desktop\sd-master-74988b2-bin-win-vulkan-x64
sd-server.exe --listen-ip 0.0.0.0 --listen-port 1234 --diffusion-model models\diffusion_models\qwen_image_2.1-Q8_0.gguf --vae models\vae\qwen_image_2.1_vae_bf16.safetensors --llm models\text_encoders\Qwen3VL-8B-Instruct-Q4_K_M.gguf --llm_vision models\text_encoders\mmproj-Qwen3VL-8B-Instruct-F16.gguf --offload-to-cpu --eager-load
