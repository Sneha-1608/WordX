import { createBrowserRouter } from 'react-router';
import LoadingScreen from './screens/LoadingScreen';
import Home from './screens/Home';
import DocumentUpload from './screens/DocumentUpload';
import Validation from './screens/Validation';
import TranslationEditor from './screens/TranslationEditor';
import Analytics from './screens/Analytics';
import TrainingPipeline from './screens/TrainingPipeline';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: LoadingScreen,
  },
  {
    path: '/home',
    Component: Home,
  },
  {
    path: '/upload',
    Component: DocumentUpload,
  },
  {
    path: '/validation',
    Component: Validation,
  },
  {
    path: '/editor',
    Component: TranslationEditor,
  },
  {
    path: '/analytics',
    Component: Analytics,
  },
  {
    path: '/training',
    Component: TrainingPipeline,
  },
  {
    path: '*',
    element: (
      <div className="w-screen h-screen flex items-center justify-center bg-ui-white">
        <div className="text-center">
          <h1 className="text-display-h2 text-brand-indigo mb-4">404</h1>
          <p className="text-body-lg text-ui-slate">Page not found</p>
        </div>
      </div>
    ),
  },
]);
