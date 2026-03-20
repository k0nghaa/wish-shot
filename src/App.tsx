import './App.css';
import { CategoryPage } from './pages/CategoryPage';
import TestPage from './pages/TestPage';

function App() {
  return (
    <>
      {import.meta.env.DEV && <TestPage />}
      <CategoryPage />
    </>
  );
}

export default App;
