import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const API_BASE = 'http://localhost:8000';

export default function ImageTo3DConverter() {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, uploading, processing, complete, error
  const [progress, setProgress] = useState({ step: '', message: '' });
  const [modelUrl, setModelUrl] = useState(null);
  const [error, setError] = useState(null);
  
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current || status !== 'complete') return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      75,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1, 3);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-5, 0, -5);
    scene.add(fillLight);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Handle resize
    const handleResize = () => {
      if (!mountRef.current) return;
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      mountRef.current?.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [status]);

  // Load 3D model
  useEffect(() => {
    if (!modelUrl || !sceneRef.current) return;

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        // Remove old model
        if (modelRef.current) {
          sceneRef.current.remove(modelRef.current);
        }

        const model = gltf.scene;
        
        // Center and scale model
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        model.scale.multiplyScalar(scale);
        
        model.position.sub(center.multiplyScalar(scale));
        
        sceneRef.current.add(model);
        modelRef.current = model;
      },
      undefined,
      (error) => {
        console.error('Error loading model:', error);
        setError('Failed to load 3D model');
      }
    );
  }, [modelUrl]);

  // Poll job status
  useEffect(() => {
    if (!jobId || status !== 'processing') return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/status/${jobId}`);
        const data = await response.json();

        setProgress({
          step: data.step,
          message: data.message
        });

        if (data.status === 'complete') {
          setStatus('complete');
          setModelUrl(`${API_BASE}/result/${jobId}`);
          clearInterval(pollInterval);
        } else if (data.status === 'error') {
          setStatus('error');
          setError(data.error || 'Processing failed');
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1000);

    return () => clearInterval(pollInterval);
  }, [jobId, status]);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type.match(/image\/(png|jpeg|jpg)/)) {
      setFile(selectedFile);
      setPreview(URL.createObjectURL(selectedFile));
      setError(null);
    } else {
      setError('Please select a PNG or JPG image');
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStatus('uploading');
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      setJobId(data.job_id);
      setStatus('processing');
      setProgress({ step: 'Initializing', message: 'Starting AI pipeline...' });
    } catch (err) {
      setStatus('error');
      setError('Upload failed. Please ensure backend is running.');
      console.error(err);
    }
  };

  const handleDownload = () => {
    if (!modelUrl) return;
    const link = document.createElement('a');
    link.href = modelUrl;
    link.download = 'model.glb';
    link.click();
  };

  const resetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  const getStepStatus = (stepName) => {
    const steps = ['Uploading', 'Estimating depth', 'Building 3D mesh', 'Applying texture'];
    const currentIndex = steps.indexOf(progress.step);
    const stepIndex = steps.indexOf(stepName);
    
    if (stepIndex < currentIndex) return 'complete';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <header className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Image to 3D Converter
          </h1>
          <p className="text-gray-300 text-lg">
            Transform any 2D image into a 3D model using AI
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Panel - Upload & Progress */}
          <div className="space-y-6">
            {/* Upload Section */}
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <h2 className="text-2xl font-semibold mb-4">Upload Image</h2>
              
              {!preview ? (
                <label className="block cursor-pointer">
                  <div className="border-2 border-dashed border-white/30 rounded-xl p-12 text-center hover:border-purple-400 transition-colors">
                    <Upload className="w-16 h-16 mx-auto mb-4 text-purple-400" />
                    <p className="text-lg mb-2">Click to upload or drag image here</p>
                    <p className="text-sm text-gray-400">PNG or JPG (max 10MB)</p>
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              ) : (
                <div className="space-y-4">
                  <img 
                    src={preview} 
                    alt="Preview" 
                    className="w-full rounded-xl shadow-lg"
                  />
                  {status === 'idle' && (
                    <button
                      onClick={handleUpload}
                      className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg hover:shadow-xl"
                    >
                      Convert to 3D
                    </button>
                  )}
                </div>
              )}

              {error && (
                <div className="mt-4 bg-red-500/20 border border-red-500/50 rounded-lg p-4 text-red-200">
                  {error}
                </div>
              )}
            </div>

            {/* Progress Section */}
            {status === 'processing' && (
              <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
                <h2 className="text-2xl font-semibold mb-6">Processing</h2>
                
                <div className="space-y-4">
                  {['Uploading', 'Estimating depth', 'Building 3D mesh', 'Applying texture'].map((step, idx) => {
                    const stepStatus = getStepStatus(step);
                    return (
                      <div key={idx} className="flex items-center space-x-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                          stepStatus === 'complete' ? 'bg-green-500' :
                          stepStatus === 'active' ? 'bg-purple-500 animate-pulse' :
                          'bg-gray-600'
                        }`}>
                          {stepStatus === 'complete' ? '✓' : idx + 1}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium ${
                            stepStatus === 'active' ? 'text-purple-300' : ''
                          }`}>
                            {step}
                          </p>
                          {stepStatus === 'active' && progress.message && (
                            <p className="text-sm text-gray-400">{progress.message}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Panel - 3D Viewer */}
          <div className="space-y-6">
            <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 border border-white/20">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-semibold">3D Preview</h2>
                {status === 'complete' && (
                  <div className="flex space-x-2">
                    <button
                      onClick={resetCamera}
                      className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                      title="Reset camera"
                    >
                      <RotateCw className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleDownload}
                      className="flex items-center space-x-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-semibold py-2 px-4 rounded-lg transition-all shadow-lg"
                    >
                      <Download className="w-5 h-5" />
                      <span>Download GLB</span>
                    </button>
                  </div>
                )}
              </div>

              <div 
                ref={mountRef}
                className="w-full h-[600px] rounded-xl bg-slate-950/50 border border-white/10"
              >
                {status !== 'complete' && (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                      <p className="text-gray-400">
                        {status === 'idle' ? 'Upload an image to begin' :
                         status === 'uploading' ? 'Uploading...' :
                         status === 'processing' ? 'Generating 3D model...' :
                         status === 'error' ? 'Error occurred' : 'Ready'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {status === 'complete' && (
                <div className="mt-4 text-sm text-gray-400">
                  <p>🖱️ Left click + drag to rotate</p>
                  <p>🖱️ Right click + drag to pan</p>
                  <p>🖱️ Scroll to zoom</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
        }
